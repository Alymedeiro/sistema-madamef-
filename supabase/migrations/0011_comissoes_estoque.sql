-- =============================================================================
-- 0011_comissoes_estoque — Fase 4B: Comissões e Estoque
--
--   1. Percentuais de comissão (padrão da profissional e por serviço) e a
--      tabela de comissões (uma por agendamento), com RLS (só a dona lê;
--      escrita das comissões só por gatilhos e funções; nada é apagado).
--   2. Comissão automática: gatilho em agendamentos (entrada/saída de
--      'atendido'; edição de um atendido recalcula a aberta) e em cobrancas
--      (recalcula a base); pagar_comissoes e resumo_comissoes (dona).
--   3. Movimentos de estoque: produtos.estoque_atual só muda pelo gatilho de
--      movimentos_estoque; o saldo existente vira um ajuste "Saldo anterior".
--   4. Baixa automática: gatilho em agendamentos (entrada/saída de
--      'atendido', troca de serviço); entrada_estoque e ajustar_estoque (dona).
--
-- pagar_comissoes, entrada_estoque e ajustar_estoque recusam quem não é a
-- dona com 'Apenas a dona pode lançar contas.' (exigir_dona_financeiro);
-- resumo_comissoes com 'Acesso não autorizado'
-- (exigir_dona_leitura_financeiro).
--
-- Dependências: 0001_base (colaboradores, servicos, produtos,
-- produtos_custos, servico_produtos, perfil_atual, colaborador_atual_id,
-- set_atualizado_em), 0002_agenda (agendamentos),
-- 0003_caixa (forma_pagamento), 0007_pacotes_cobranca (pacotes_vendidos,
-- cobrancas), 0010_financeiro (contas_pagar, exigir_dona_financeiro,
-- exigir_dona_leitura_financeiro, criar_conta_pagar).
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
-- mudança de status é desfeita); aberta → cancelada. Continuando 'atendido'
-- com profissional, serviço, início ou valor previsto alterados (Ruling
-- P4B-R3): recalcula a comissão aberta (paga não muda; atendido de antes da
-- 0011, sem comissão, continua sem).
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
  elsif tg_op = 'UPDATE' and old.status = 'atendido' and new.status = 'atendido' then
    if (old.profissional_id, old.servico_id, old.inicio, old.valor_previsto_centavos)
       is distinct from
       (new.profissional_id, new.servico_id, new.inicio, new.valor_previsto_centavos)
       and exists (
         select 1 from public.comissoes c
         where c.agendamento_id = new.id and c.status = 'aberta'
       ) then
      perform public.gravar_comissao(new.id);
    end if;
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
  after insert or update of status, profissional_id, servico_id, inicio, valor_previsto_centavos
  on public.agendamentos
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

-- =============================================================================
-- 3. Movimentos de estoque
-- =============================================================================

create type public.tipo_movimento_estoque as enum (
  'entrada', 'ajuste', 'baixa_atendimento', 'estorno_atendimento'
);

-- Histórico do estoque: estoque_atual de cada produto = soma das quantidades
-- (com sinal) dos seus movimentos. Nada é alterado nem apagado.
create table public.movimentos_estoque (
  id uuid primary key default gen_random_uuid(),
  produto_id uuid not null references public.produtos (id),
  tipo public.tipo_movimento_estoque not null,
  -- Entrada > 0; baixa < 0; estorno > 0; ajuste com o sinal da diferença.
  quantidade numeric(12, 3) not null check (quantidade <> 0),
  -- Entrada: custo unitário da compra (também gravado em produtos_custos).
  custo_unitario_centavos int check (custo_unitario_centavos >= 0),
  -- Baixa/estorno: o atendimento que gerou o movimento.
  agendamento_id uuid references public.agendamentos (id),
  motivo text check (char_length(btrim(motivo)) between 1 and 200),
  -- Entrada com "lançar despesa": a conta a pagar (produto) criada junto.
  conta_pagar_id uuid references public.contas_pagar (id),
  -- Null quando gerado por gatilho sem usuário (ex.: migração, service_role).
  responsavel_id uuid references public.colaboradores (id),
  criado_em timestamptz not null default now(),
  constraint movimentos_estoque_entrada_check check (
    tipo <> 'entrada' or (quantidade > 0 and custo_unitario_centavos is not null)
  ),
  constraint movimentos_estoque_baixa_check check (
    tipo <> 'baixa_atendimento' or (quantidade < 0 and agendamento_id is not null)
  ),
  constraint movimentos_estoque_estorno_check check (
    tipo <> 'estorno_atendimento' or (quantidade > 0 and agendamento_id is not null)
  ),
  constraint movimentos_estoque_ajuste_check check (tipo <> 'ajuste' or motivo is not null)
);

create index movimentos_estoque_produto_criado_idx
  on public.movimentos_estoque (produto_id, criado_em);
create index movimentos_estoque_agendamento_idx on public.movimentos_estoque (agendamento_id);
create index movimentos_estoque_conta_pagar_idx
  on public.movimentos_estoque (conta_pagar_id) where conta_pagar_id is not null;

-- Soma o movimento no saldo do produto. O marcador local da transação
-- libera a mudança de estoque_atual no gatilho de produtos abaixo.
create function public.movimentos_estoque_saldo()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform set_config('app.movimento_estoque', '1', true);
  update public.produtos
  set estoque_atual = estoque_atual + new.quantidade
  where id = new.produto_id;
  perform set_config('app.movimento_estoque', '', true);
  return null;
end;
$$;

revoke execute on function public.movimentos_estoque_saldo() from public, anon, authenticated;

create trigger movimentos_estoque_saldo
  after insert on public.movimentos_estoque
  for each row execute function public.movimentos_estoque_saldo();

-- estoque_atual só muda pelo gatilho acima (marcador + chamada vinda de um
-- gatilho: um set_config feito pelo cliente sozinho não basta). Produto novo
-- nasce com estoque 0 (o estoque inicial entra como ajuste).
create function public.produtos_estoque_protegido()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.estoque_atual <> 0 then
      raise exception 'O estoque só muda por entrada ou ajuste.' using errcode = 'P0001';
    end if;
  elsif new.estoque_atual is distinct from old.estoque_atual
        and (coalesce(current_setting('app.movimento_estoque', true), '') <> '1'
             or pg_trigger_depth() < 2) then
    raise exception 'O estoque só muda por entrada ou ajuste.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

revoke execute on function public.produtos_estoque_protegido() from public, anon, authenticated;

create trigger produtos_estoque_protegido
  before insert or update on public.produtos
  for each row execute function public.produtos_estoque_protegido();

-- Saldo existente: um ajuste "Saldo anterior" por produto com estoque ≠ 0,
-- sem somar de novo (gatilho de saldo desligado), para o histórico fechar
-- com o saldo.
alter table public.movimentos_estoque disable trigger movimentos_estoque_saldo;
insert into public.movimentos_estoque (produto_id, tipo, quantidade, motivo)
select p.id, 'ajuste', p.estoque_atual, 'Saldo anterior'
from public.produtos p
where p.estoque_atual <> 0;
alter table public.movimentos_estoque enable trigger movimentos_estoque_saldo;

-- RLS: só a dona lê; escrita só por gatilhos e pelas funções da seção 4.
-- Ninguém apaga.
alter table public.movimentos_estoque enable row level security;

revoke all on public.movimentos_estoque from anon, authenticated;
revoke delete, truncate on public.movimentos_estoque from service_role;
grant select on public.movimentos_estoque to authenticated;

create policy movimentos_estoque_select on public.movimentos_estoque
  for select to authenticated
  using ((select public.perfil_atual()) = 'dona');

-- =============================================================================
-- 4. Baixa automática no atendimento, entrada e ajuste
-- =============================================================================

-- Uma baixa por item de servico_produtos do serviço (quantidade negativa).
create function public.baixar_estoque_atendimento(p_agendamento uuid, p_servico uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.movimentos_estoque (
    produto_id, tipo, quantidade, agendamento_id, responsavel_id
  )
  select sp.produto_id, 'baixa_atendimento', -sp.quantidade, p_agendamento,
         public.colaborador_atual_id()
  from public.servico_produtos sp
  where sp.servico_id = p_servico
  order by sp.produto_id;
end;
$$;

revoke execute on function public.baixar_estoque_atendimento(uuid, uuid)
  from public, anon, authenticated, service_role;

-- Estorna o que foi baixado nesse agendamento: por produto, a soma líquida
-- (baixas − estornos) quando negativa, independente da lista atual do serviço.
create function public.estornar_estoque_atendimento(p_agendamento uuid, p_motivo text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.movimentos_estoque (
    produto_id, tipo, quantidade, agendamento_id, motivo, responsavel_id
  )
  select m.produto_id, 'estorno_atendimento', -sum(m.quantidade), p_agendamento,
         p_motivo, public.colaborador_atual_id()
  from public.movimentos_estoque m
  where m.agendamento_id = p_agendamento
  group by m.produto_id
  having sum(m.quantidade) < 0
  order by m.produto_id;
end;
$$;

revoke execute on function public.estornar_estoque_atendimento(uuid, text)
  from public, anon, authenticated, service_role;

-- Entrando em 'atendido': baixas. Saindo: estornos ("Atendimento
-- desmarcado"). Continuando 'atendido' com outro serviço (Ruling P4B-R3):
-- estorna o do serviço anterior ("Serviço alterado") e baixa o do novo. Roda
-- junto com agendamentos_comissao no mesmo comando: se um levantar erro, tudo
-- é desfeito.
create function public.agendamentos_estoque()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'atendido'
     and (tg_op = 'INSERT' or old.status is distinct from 'atendido') then
    perform public.baixar_estoque_atendimento(new.id, new.servico_id);
  elsif tg_op = 'UPDATE' and old.status = 'atendido'
        and new.status is distinct from 'atendido' then
    perform public.estornar_estoque_atendimento(new.id, 'Atendimento desmarcado');
  elsif tg_op = 'UPDATE' and old.status = 'atendido' and new.status = 'atendido'
        and new.servico_id is distinct from old.servico_id then
    perform public.estornar_estoque_atendimento(new.id, 'Serviço alterado');
    perform public.baixar_estoque_atendimento(new.id, new.servico_id);
  end if;
  return null;
end;
$$;

revoke execute on function public.agendamentos_estoque() from public, anon, authenticated;

create trigger agendamentos_estoque
  after insert or update of status, servico_id on public.agendamentos
  for each row execute function public.agendamentos_estoque();

-- Compra: soma a quantidade, atualiza o custo do produto e, se pedido e o
-- total for > 0, lança a conta a pagar (produto, em aberto) "Compra — <nome>".
-- Devolve o id do movimento.
create function public.entrada_estoque(
  p_produto uuid,
  p_quantidade numeric,
  p_custo_unitario_centavos int,
  p_lancar_despesa boolean,
  p_vencimento date,
  p_fornecedor text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_quantidade numeric := round(p_quantidade, 3);
  v_total int;
  v_nome text;
  v_id uuid;
  v_conta uuid;
begin
  perform public.exigir_dona_financeiro();
  if v_quantidade is null or v_quantidade <= 0 then
    raise exception 'A quantidade deve ser maior que zero.' using errcode = 'P0001';
  end if;

  insert into public.movimentos_estoque (
    produto_id, tipo, quantidade, custo_unitario_centavos, responsavel_id
  ) values (
    p_produto, 'entrada', v_quantidade, p_custo_unitario_centavos,
    public.colaborador_atual_id()
  )
  returning id into v_id;

  insert into public.produtos_custos (produto_id, custo_unitario_centavos)
  values (p_produto, p_custo_unitario_centavos)
  on conflict (produto_id) do update
  set custo_unitario_centavos = excluded.custo_unitario_centavos;

  v_total := round(v_quantidade * p_custo_unitario_centavos)::int;
  if coalesce(p_lancar_despesa, false) and v_total > 0 then
    select btrim(p.nome) into v_nome from public.produtos p where p.id = p_produto;
    v_conta := public.criar_conta_pagar(
      left('Compra — ' || v_nome, 120), 'produto', p_fornecedor, v_total, p_vencimento, null
    );
    update public.movimentos_estoque set conta_pagar_id = v_conta where id = v_id;
  end if;

  return v_id;
end;
$$;

revoke execute on function public.entrada_estoque(uuid, numeric, int, boolean, date, text)
  from public, anon, authenticated;
grant execute on function public.entrada_estoque(uuid, numeric, int, boolean, date, text)
  to authenticated;

-- Contagem: grava um ajuste com a diferença entre a quantidade contada e o
-- saldo atual. Devolve o id do movimento.
create function public.ajustar_estoque(
  p_produto uuid,
  p_quantidade_contada numeric,
  p_motivo text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_contada numeric := round(p_quantidade_contada, 3);
  v_atual numeric;
  v_id uuid;
begin
  perform public.exigir_dona_financeiro();
  if v_contada is null or v_contada < 0 then
    raise exception 'A quantidade contada não pode ser negativa.' using errcode = 'P0001';
  end if;
  if nullif(btrim(p_motivo), '') is null then
    raise exception 'Informe o motivo do ajuste.' using errcode = 'P0001';
  end if;

  select p.estoque_atual into v_atual from public.produtos p where p.id = p_produto for update;
  if not found then
    raise exception 'Produto não encontrado.' using errcode = 'P0001';
  end if;
  if v_contada = v_atual then
    raise exception 'O estoque já está com essa quantidade.' using errcode = 'P0001';
  end if;

  insert into public.movimentos_estoque (produto_id, tipo, quantidade, motivo, responsavel_id)
  values (p_produto, 'ajuste', v_contada - v_atual, btrim(p_motivo), public.colaborador_atual_id())
  returning id into v_id;
  return v_id;
end;
$$;

revoke execute on function public.ajustar_estoque(uuid, numeric, text)
  from public, anon, authenticated;
grant execute on function public.ajustar_estoque(uuid, numeric, text) to authenticated;
