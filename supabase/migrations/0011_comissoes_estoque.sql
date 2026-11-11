-- =============================================================================
-- 0011_comissoes_estoque — Fase 4B: Comissões e Estoque
--
--   1. Percentuais de comissão (padrão da profissional e por serviço) e a
--      tabela de comissões (uma por agendamento), com RLS (só a dona lê;
--      escrita das comissões só por gatilhos e funções; nada é apagado).
--   2. Comissão automática: gatilho em agendamentos (entrada/saída de
--      'atendido') e em cobrancas (recalcula a base); pagar_comissoes e
--      resumo_comissoes (dona).
--
-- pagar_comissoes recusa quem não é a dona com 'Apenas a dona pode lançar
-- contas.' (exigir_dona_financeiro); resumo_comissoes com 'Acesso não
-- autorizado' (exigir_dona_leitura_financeiro).
--
-- Dependências: 0001_base (colaboradores, servicos, perfil_atual,
-- colaborador_atual_id, set_atualizado_em), 0002_agenda (agendamentos),
-- 0003_caixa (forma_pagamento), 0007_pacotes_cobranca (pacotes_vendidos,
-- cobrancas), 0010_financeiro (contas_pagar, exigir_dona_financeiro,
-- exigir_dona_leitura_financeiro).
-- =============================================================================

-- =============================================================================
-- 1. Percentuais e comissões
-- =============================================================================

-- % padrão da profissional. Sem linha = 0%.
create table public.colaboradores_comissao (
  colaborador_id uuid primary key references public.colaboradores (id) on delete cascade,
  percentual numeric(5, 2) not null check (percentual between 0 and 100),
  atualizado_em timestamptz not null default now()
);

-- % do serviço (sobrepõe a da profissional). Sem linha = usa a da profissional.
create table public.servicos_comissao (
  servico_id uuid primary key references public.servicos (id) on delete cascade,
  percentual numeric(5, 2) not null check (percentual between 0 and 100),
  atualizado_em timestamptz not null default now()
);

create trigger colaboradores_comissao_atualizado_em before update on public.colaboradores_comissao
  for each row execute function public.set_atualizado_em();
create trigger servicos_comissao_atualizado_em before update on public.servicos_comissao
  for each row execute function public.set_atualizado_em();

create type public.status_comissao as enum ('aberta', 'paga', 'cancelada');

-- Uma comissão por agendamento: desmarcar 'atendido' cancela; remarcar reabre
-- a mesma linha. O percentual é gravado no momento do atendimento; enquanto
-- aberta, só a base (e o valor) é recalculada por uma cobrança posterior.
create table public.comissoes (
  id uuid primary key default gen_random_uuid(),
  agendamento_id uuid not null unique references public.agendamentos (id),
  profissional_id uuid not null references public.colaboradores (id),
  servico_id uuid not null references public.servicos (id),
  -- 1º dia do mês do início do agendamento (São Paulo).
  competencia date not null check (competencia = date_trunc('month', competencia)::date),
  base_centavos int not null check (base_centavos >= 0),
  percentual numeric(5, 2) not null check (percentual between 0 and 100),
  valor_centavos int not null check (valor_centavos >= 0),
  status public.status_comissao not null default 'aberta',
  cancelada_em timestamptz,
  cancelada_motivo text check (char_length(cancelada_motivo) between 1 and 200),
  -- Despesa (salario, paga) criada por pagar_comissoes; nula quando o total
  -- pago foi 0 (todas a 0%).
  conta_pagar_id uuid references public.contas_pagar (id),
  pago_em date,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  constraint comissoes_paga_check check ((status = 'paga') = (pago_em is not null)),
  constraint comissoes_cancelada_check check (
    (status = 'cancelada') = (cancelada_em is not null)
    and (status = 'cancelada') = (cancelada_motivo is not null)
  ),
  constraint comissoes_conta_check check (conta_pagar_id is null or status = 'paga')
);

create index comissoes_profissional_competencia_idx
  on public.comissoes (profissional_id, competencia);
create index comissoes_conta_pagar_idx on public.comissoes (conta_pagar_id);
create index comissoes_servico_idx on public.comissoes (servico_id);

create trigger comissoes_atualizado_em before update on public.comissoes
  for each row execute function public.set_atualizado_em();

-- RLS. Percentuais: no padrão de produtos_custos (tudo só a dona); delete só
-- em servicos_comissao (limpar a % do serviço é configuração). Comissões: só
-- a dona lê; escrita só pelos gatilhos e funções da seção 2. Anon nada.
alter table public.colaboradores_comissao enable row level security;
alter table public.servicos_comissao enable row level security;
alter table public.comissoes enable row level security;

revoke all on public.colaboradores_comissao, public.servicos_comissao, public.comissoes
  from anon, authenticated;
revoke delete, truncate on public.colaboradores_comissao, public.comissoes from service_role;
grant select, insert, update on public.colaboradores_comissao, public.servicos_comissao
  to authenticated;
grant delete on public.servicos_comissao to authenticated;
grant select on public.comissoes to authenticated;

create policy colaboradores_comissao_select on public.colaboradores_comissao
  for select to authenticated
  using ((select public.perfil_atual()) = 'dona');
create policy colaboradores_comissao_insert on public.colaboradores_comissao
  for insert to authenticated
  with check ((select public.perfil_atual()) = 'dona');
create policy colaboradores_comissao_update on public.colaboradores_comissao
  for update to authenticated
  using ((select public.perfil_atual()) = 'dona')
  with check ((select public.perfil_atual()) = 'dona');

create policy servicos_comissao_select on public.servicos_comissao
  for select to authenticated
  using ((select public.perfil_atual()) = 'dona');
create policy servicos_comissao_insert on public.servicos_comissao
  for insert to authenticated
  with check ((select public.perfil_atual()) = 'dona');
create policy servicos_comissao_update on public.servicos_comissao
  for update to authenticated
  using ((select public.perfil_atual()) = 'dona')
  with check ((select public.perfil_atual()) = 'dona');
create policy servicos_comissao_delete on public.servicos_comissao
  for delete to authenticated
  using ((select public.perfil_atual()) = 'dona');

create policy comissoes_select on public.comissoes
  for select to authenticated
  using ((select public.perfil_atual()) = 'dona');

-- =============================================================================
-- 2. Comissão automática, pagamento e resumo
-- =============================================================================

-- % efetiva: a do serviço; senão a padrão da profissional; senão 0.
create function public.percentual_comissao(p_servico uuid, p_profissional uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select sc.percentual from public.servicos_comissao sc where sc.servico_id = p_servico),
    (select cc.percentual from public.colaboradores_comissao cc
     where cc.colaborador_id = p_profissional),
    0
  )::numeric
$$;

revoke execute on function public.percentual_comissao(uuid, uuid)
  from public, anon, authenticated, service_role;

-- Base em centavos: sessão de pacote → valor do pacote ÷ sessões (ao
-- centavo); senão a cobrança do agendamento (bruto − desconto); senão o
-- valor previsto.
create function public.base_comissao(p_agendamento uuid)
returns int
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_ag public.agendamentos;
  v_base int;
begin
  select * into v_ag from public.agendamentos a where a.id = p_agendamento;
  if not found then
    return 0;
  end if;

  if v_ag.pacote_vendido_id is not null then
    select round(p.valor_total_centavos::numeric / p.total_sessoes)::int into v_base
    from public.pacotes_vendidos p
    where p.id = v_ag.pacote_vendido_id;
    if found then
      return v_base;
    end if;
  end if;

  select c.valor_bruto_centavos - c.desconto_centavos into v_base
  from public.cobrancas c
  where c.agendamento_id = p_agendamento;
  if found then
    return v_base;
  end if;

  return v_ag.valor_previsto_centavos;
end;
$$;

revoke execute on function public.base_comissao(uuid)
  from public, anon, authenticated, service_role;

-- Cria a comissão do agendamento ou reabre (aberta/cancelada) recalculando
-- percentual, base, valor e competência. Paga: não mexe.
create function public.gravar_comissao(p_agendamento uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ag public.agendamentos;
  v_percentual numeric;
  v_base int;
  v_competencia date;
begin
  select * into v_ag from public.agendamentos a where a.id = p_agendamento;
  if not found then
    return;
  end if;

  v_percentual := public.percentual_comissao(v_ag.servico_id, v_ag.profissional_id);
  v_base := public.base_comissao(p_agendamento);
  v_competencia := date_trunc('month', (v_ag.inicio at time zone 'America/Sao_Paulo'))::date;

  insert into public.comissoes (
    agendamento_id, profissional_id, servico_id, competencia,
    base_centavos, percentual, valor_centavos
  ) values (
    v_ag.id, v_ag.profissional_id, v_ag.servico_id, v_competencia,
    v_base, v_percentual, round(v_base * v_percentual / 100)::int
  )
  on conflict (agendamento_id) do update
  set profissional_id = excluded.profissional_id,
      servico_id = excluded.servico_id,
      competencia = excluded.competencia,
      base_centavos = excluded.base_centavos,
      percentual = excluded.percentual,
      valor_centavos = excluded.valor_centavos,
      status = 'aberta',
      cancelada_em = null,
      cancelada_motivo = null
  where public.comissoes.status <> 'paga';
end;
$$;

revoke execute on function public.gravar_comissao(uuid)
  from public, anon, authenticated, service_role;

-- Entrando em 'atendido': grava/reabre a comissão. Saindo: paga → recusa (a
-- mudança de status é desfeita); aberta → cancelada.
create function public.agendamentos_comissao()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status public.status_comissao;
begin
  if new.status = 'atendido'
     and (tg_op = 'INSERT' or old.status is distinct from 'atendido') then
    perform public.gravar_comissao(new.id);
  elsif tg_op = 'UPDATE' and old.status = 'atendido'
        and new.status is distinct from 'atendido' then
    select c.status into v_status
    from public.comissoes c
    where c.agendamento_id = new.id
    for update;
    if v_status = 'paga' then
      raise exception 'A comissão deste atendimento já foi paga.' using errcode = 'P0001';
    elsif v_status = 'aberta' then
      update public.comissoes
      set status = 'cancelada',
          cancelada_em = now(),
          cancelada_motivo = 'Atendimento desmarcado'
      where agendamento_id = new.id;
    end if;
  end if;
  return null;
end;
$$;

revoke execute on function public.agendamentos_comissao() from public, anon, authenticated;

create trigger agendamentos_comissao
  after insert or update of status on public.agendamentos
  for each row execute function public.agendamentos_comissao();

-- Cobrança do agendamento lançada depois do atendido: recalcula base e valor
-- da comissão aberta (percentual mantido). Cobrança de pacote não mexe.
create function public.cobrancas_comissao()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_base int := public.base_comissao(new.agendamento_id);
begin
  update public.comissoes
  set base_centavos = v_base,
      valor_centavos = round(v_base * percentual / 100)::int
  where agendamento_id = new.agendamento_id and status = 'aberta';
  return null;
end;
$$;

revoke execute on function public.cobrancas_comissao() from public, anon, authenticated;

create trigger cobrancas_comissao
  after insert on public.cobrancas
  for each row when (new.origem = 'agendamento')
  execute function public.cobrancas_comissao();

-- Paga as comissões em aberto da profissional na competência (mês de
-- p_competencia). Total > 0: cria a despesa já paga (salario, "Comissão —
-- <nome> — <MM/AAAA>") e liga as comissões a ela; total 0 (todas a 0%): só
-- marca pagas. Devolve o id da conta (ou null). Forma 'a_receber' → 23514.
create function public.pagar_comissoes(
  p_profissional uuid,
  p_competencia date,
  p_pago_em date,
  p_forma public.forma_pagamento
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_competencia date := date_trunc('month', p_competencia)::date;
  v_ids uuid[];
  v_total bigint;
  v_nome text;
  v_conta uuid;
begin
  perform public.exigir_dona_financeiro();
  if p_forma = 'a_receber' then
    raise exception 'A forma de pagamento não pode ser a receber.' using errcode = '23514';
  end if;

  -- FOR UPDATE: dois pagamentos simultâneos do mesmo par esperam um pelo outro.
  select coalesce(array_agg(t.id), '{}'), coalesce(sum(t.valor_centavos), 0)
  into v_ids, v_total
  from (
    select c.id, c.valor_centavos
    from public.comissoes c
    where c.profissional_id = p_profissional
      and c.competencia = v_competencia
      and c.status = 'aberta'
    for update
  ) t;
  if cardinality(v_ids) = 0 then
    raise exception 'Não há comissões em aberto.' using errcode = 'P0001';
  end if;

  if v_total > 0 then
    select btrim(co.nome) into v_nome from public.colaboradores co where co.id = p_profissional;

    insert into public.contas_pagar (
      descricao, categoria, valor_centavos, vencimento, status, pago_em, forma, lancada_por
    ) values (
      left('Comissão — ' || v_nome || ' — ' || to_char(v_competencia, 'MM/YYYY'), 120),
      'salario', v_total, p_pago_em, 'paga', p_pago_em, p_forma, public.colaborador_atual_id()
    )
    returning id into v_conta;
  end if;

  update public.comissoes
  set status = 'paga', pago_em = p_pago_em, conta_pagar_id = v_conta
  where id = any (v_ids);

  return v_conta;
end;
$$;

revoke execute on function public.pagar_comissoes(uuid, date, date, public.forma_pagamento)
  from public, anon, authenticated;
grant execute on function public.pagar_comissoes(uuid, date, date, public.forma_pagamento)
  to authenticated;

-- Por profissional e competência (de date_trunc('month', p_de) até p_ate),
-- sem as canceladas: quantidade, base, valor em aberto e valor pago.
create function public.resumo_comissoes(p_de date, p_ate date)
returns table (
  profissional_id uuid,
  nome text,
  competencia date,
  qtd int,
  base bigint,
  aberto bigint,
  pago bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.exigir_dona_leitura_financeiro();

  return query
  select c.profissional_id, co.nome, c.competencia,
         count(*)::int,
         sum(c.base_centavos)::bigint,
         coalesce(sum(c.valor_centavos) filter (where c.status = 'aberta'), 0)::bigint,
         coalesce(sum(c.valor_centavos) filter (where c.status = 'paga'), 0)::bigint
  from public.comissoes c
  join public.colaboradores co on co.id = c.profissional_id
  where c.status <> 'cancelada'
    and c.competencia between date_trunc('month', p_de)::date and p_ate
  group by c.profissional_id, co.nome, c.competencia
  order by c.competencia, co.nome, c.profissional_id;
end;
$$;

revoke execute on function public.resumo_comissoes(date, date) from public, anon, authenticated;
grant execute on function public.resumo_comissoes(date, date) to authenticated;
