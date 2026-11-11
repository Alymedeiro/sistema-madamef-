-- =============================================================================
-- 0010_financeiro — Fase 4: Financeiro
--
--   1. Contas a pagar e contas fixas: tipos, tabelas e RLS (só a dona lê;
--      escrita só pelas funções security definer; nada é apagado).
--   2. Funções da dona: criar, editar, pagar e cancelar conta a pagar, lançar
--      vale, criar/desativar conta fixa e gerar as contas fixas do período.
--   3. Bucket privado `financeiro` (anexos das contas a pagar) e políticas em
--      storage.objects (só a dona envia e lê).
--   4. Contas a receber manuais e recebimentos de parcelas no caixa do dia
--      (criar/cancelar conta a receber, receber_parcela) e RLS.
--   5. fechar_caixa passa a somar os recebimentos do caixa (e não conta os
--      pagamentos 'a_receber', que só entram quando a parcela é recebida).
--   6. Resumo do painel, fluxo de caixa (por dia/mês, por forma, por
--      categoria), avisos lidos e relatórios gerados.
--
-- As funções das seções 1–4 recusam quem não é a dona com 'Apenas a dona
-- pode lançar contas.' (P0001); as da seção 6 com 'Acesso não autorizado'.
--
-- Dependências: 0001_base (colaboradores, clientes, perfil_atual,
-- colaborador_atual_id, set_atualizado_em), 0003_caixa (forma_pagamento,
-- caixas, pagamentos, contas_receber, caixa_aberto_hoje_id, fechar_caixa).
-- =============================================================================

-- =============================================================================
-- 1. Contas a pagar e contas fixas
-- =============================================================================
create type public.categoria_despesa as enum (
  'aluguel', 'fornecedor', 'produto', 'salario', 'imposto', 'vale', 'outros'
);
create type public.status_conta as enum ('aberta', 'paga', 'cancelada');

-- Modelo mensal: gerar_contas_fixas cria uma conta por competência (mês).
-- Vale nunca é conta fixa (exige colaboradora).
create table public.contas_fixas (
  id uuid primary key default gen_random_uuid(),
  descricao text not null check (char_length(btrim(descricao)) between 1 and 120),
  categoria public.categoria_despesa not null check (categoria <> 'vale'),
  fornecedor text check (char_length(fornecedor) <= 120),
  valor_centavos int not null check (valor_centavos > 0),
  -- Mês sem esse dia → último dia do mês.
  dia_vencimento int not null check (dia_vencimento between 1 and 31),
  ativa boolean not null default true,
  -- Primeira competência (1º dia do mês).
  inicio date not null check (inicio = date_trunc('month', inicio)::date),
  criado_por uuid not null references public.colaboradores (id),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create index contas_fixas_criado_por_idx on public.contas_fixas (criado_por);

create trigger contas_fixas_atualizado_em before update on public.contas_fixas
  for each row execute function public.set_atualizado_em();

create table public.contas_pagar (
  id uuid primary key default gen_random_uuid(),
  descricao text not null check (char_length(btrim(descricao)) between 1 and 120),
  categoria public.categoria_despesa not null,
  fornecedor text check (char_length(fornecedor) <= 120),
  -- Vales: a colaboradora que recebeu.
  colaborador_id uuid references public.colaboradores (id),
  valor_centavos int not null check (valor_centavos > 0),
  vencimento date not null,
  status public.status_conta not null default 'aberta',
  pago_em date,
  forma public.forma_pagamento check (forma <> 'a_receber'),
  -- Objeto do bucket `financeiro` (enviado pelo navegador antes do registro).
  anexo_path text unique
    check (anexo_path ~ '^contas_pagar/[0-9a-f-]{36}\.(jpg|png|pdf)$'),
  -- Gerada por uma conta fixa: competência = 1º dia do mês.
  conta_fixa_id uuid references public.contas_fixas (id),
  competencia date check (competencia = date_trunc('month', competencia)::date),
  cancelada_motivo text check (char_length(cancelada_motivo) between 1 and 200),
  cancelada_em timestamptz,
  cancelada_por uuid references public.colaboradores (id),
  lancada_por uuid not null references public.colaboradores (id),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  -- Uma conta por conta fixa e mês (gerar_contas_fixas é idempotente).
  constraint contas_pagar_fixa_competencia_key unique (conta_fixa_id, competencia),
  constraint contas_pagar_fixa_check check ((conta_fixa_id is null) = (competencia is null)),
  constraint contas_pagar_paga_check check (
    (status = 'paga') = (pago_em is not null)
    and (status = 'paga') = (forma is not null)
  ),
  constraint contas_pagar_cancelada_check check (
    (status = 'cancelada') = (cancelada_motivo is not null)
    and (status = 'cancelada') = (cancelada_em is not null)
    and (status = 'cancelada') = (cancelada_por is not null)
  ),
  constraint contas_pagar_vale_check check ((categoria = 'vale') = (colaborador_id is not null))
);

create index contas_pagar_vencimento_idx on public.contas_pagar (vencimento);
create index contas_pagar_pago_em_idx on public.contas_pagar (pago_em);
create index contas_pagar_status_vencimento_idx on public.contas_pagar (status, vencimento);
create index contas_pagar_colaborador_idx on public.contas_pagar (colaborador_id);
create index contas_pagar_cancelada_por_idx on public.contas_pagar (cancelada_por);
create index contas_pagar_lancada_por_idx on public.contas_pagar (lancada_por);

create trigger contas_pagar_atualizado_em before update on public.contas_pagar
  for each row execute function public.set_atualizado_em();

-- RLS: anon sem nenhum privilégio; authenticated só lê (só a dona vê linhas).
-- Escrita só pelas funções da seção 2. Sem delete para ninguém.
alter table public.contas_fixas enable row level security;
alter table public.contas_pagar enable row level security;

revoke all on public.contas_fixas, public.contas_pagar from anon, authenticated;
revoke delete, truncate on public.contas_fixas, public.contas_pagar from service_role;
grant select on public.contas_fixas, public.contas_pagar to authenticated;

create policy contas_fixas_select on public.contas_fixas
  for select to authenticated
  using ((select public.perfil_atual()) = 'dona');

create policy contas_pagar_select on public.contas_pagar
  for select to authenticated
  using ((select public.perfil_atual()) = 'dona');

-- =============================================================================
-- 2. Funções da dona
-- =============================================================================

-- Recusa quem não é a dona. Chamada só pelas funções desta migração.
create function public.exigir_dona_financeiro()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if public.perfil_atual() is distinct from 'dona' then
    raise exception 'Apenas a dona pode lançar contas.' using errcode = 'P0001';
  end if;
end;
$$;

revoke execute on function public.exigir_dona_financeiro()
  from public, anon, authenticated, service_role;

-- O anexo (quando informado) já foi enviado ao bucket `financeiro`.
-- security definer: lê storage.objects independentemente das políticas.
create function public.conferir_anexo_financeiro(p_anexo_path text)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_anexo_path is not null and not exists (
    select 1 from storage.objects o
    where o.bucket_id = 'financeiro' and o.name = p_anexo_path
  ) then
    raise exception 'Anexo não encontrado. Envie o arquivo de novo.' using errcode = 'P0001';
  end if;
end;
$$;

revoke execute on function public.conferir_anexo_financeiro(text)
  from public, anon, authenticated, service_role;

-- Trava a conta e confere que ainda está em aberto.
create function public.travar_conta_aberta(p_conta uuid)
returns public.contas_pagar
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conta public.contas_pagar;
begin
  select * into v_conta from public.contas_pagar c where c.id = p_conta for update;
  if not found then
    raise exception 'Conta não encontrada.' using errcode = 'P0001';
  elsif v_conta.status = 'paga' then
    raise exception 'Esta conta já foi paga.' using errcode = 'P0001';
  elsif v_conta.status = 'cancelada' then
    raise exception 'Esta conta foi cancelada.' using errcode = 'P0001';
  end if;
  return v_conta;
end;
$$;

revoke execute on function public.travar_conta_aberta(uuid)
  from public, anon, authenticated, service_role;

-- Conta avulsa em aberto. Formato inválido do anexo → 23514 (check da
-- tabela); anexo inexistente → P0001. Categoria 'vale' → 23514 (use
-- lancar_vale).
create function public.criar_conta_pagar(
  p_descricao text,
  p_categoria public.categoria_despesa,
  p_fornecedor text,
  p_valor_centavos int,
  p_vencimento date,
  p_anexo_path text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  perform public.exigir_dona_financeiro();

  insert into public.contas_pagar (
    descricao, categoria, fornecedor, valor_centavos, vencimento, anexo_path, lancada_por
  ) values (
    btrim(p_descricao), p_categoria, nullif(btrim(p_fornecedor), ''), p_valor_centavos,
    p_vencimento, p_anexo_path, public.colaborador_atual_id()
  )
  returning id into v_id;

  perform public.conferir_anexo_financeiro(p_anexo_path);
  return v_id;
end;
$$;

revoke execute on function public.criar_conta_pagar(
  text, public.categoria_despesa, text, int, date, text
) from public, anon, authenticated;
grant execute on function public.criar_conta_pagar(
  text, public.categoria_despesa, text, int, date, text
) to authenticated;

-- Só conta em aberto. p_anexo_path substitui o anexo (null remove).
create function public.editar_conta_pagar(
  p_conta uuid,
  p_descricao text,
  p_categoria public.categoria_despesa,
  p_fornecedor text,
  p_valor_centavos int,
  p_vencimento date,
  p_anexo_path text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.exigir_dona_financeiro();
  perform public.travar_conta_aberta(p_conta);

  update public.contas_pagar
  set descricao = btrim(p_descricao),
      categoria = p_categoria,
      fornecedor = nullif(btrim(p_fornecedor), ''),
      valor_centavos = p_valor_centavos,
      vencimento = p_vencimento,
      anexo_path = p_anexo_path
  where id = p_conta;

  perform public.conferir_anexo_financeiro(p_anexo_path);
end;
$$;

revoke execute on function public.editar_conta_pagar(
  uuid, text, public.categoria_despesa, text, int, date, text
) from public, anon, authenticated;
grant execute on function public.editar_conta_pagar(
  uuid, text, public.categoria_despesa, text, int, date, text
) to authenticated;

-- Forma 'a_receber' → 23514.
create function public.pagar_conta(
  p_conta uuid,
  p_pago_em date,
  p_forma public.forma_pagamento
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.exigir_dona_financeiro();
  perform public.travar_conta_aberta(p_conta);

  update public.contas_pagar
  set status = 'paga', pago_em = p_pago_em, forma = p_forma
  where id = p_conta;
end;
$$;

revoke execute on function public.pagar_conta(uuid, date, public.forma_pagamento)
  from public, anon, authenticated;
grant execute on function public.pagar_conta(uuid, date, public.forma_pagamento)
  to authenticated;

-- Motivo com trim: vazio → P0001; mais de 200 caracteres → 23514.
create function public.cancelar_conta_pagar(p_conta uuid, p_motivo text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_motivo text := nullif(btrim(p_motivo), '');
begin
  perform public.exigir_dona_financeiro();
  if v_motivo is null then
    raise exception 'Informe o motivo do cancelamento.' using errcode = 'P0001';
  end if;
  perform public.travar_conta_aberta(p_conta);

  update public.contas_pagar
  set status = 'cancelada',
      cancelada_motivo = v_motivo,
      cancelada_em = now(),
      cancelada_por = public.colaborador_atual_id()
  where id = p_conta;
end;
$$;

revoke execute on function public.cancelar_conta_pagar(uuid, text)
  from public, anon, authenticated;
grant execute on function public.cancelar_conta_pagar(uuid, text) to authenticated;

-- Vale: despesa já paga em p_data, categoria 'vale', ligada à colaboradora
-- ativa (inativa ou inexistente → 'Colaboradora não encontrada.').
-- Descrição "Vale — <nome>" ou "Vale — <nome> · <obs>" (até 120 caracteres).
create function public.lancar_vale(
  p_colaborador uuid,
  p_valor_centavos int,
  p_data date,
  p_forma public.forma_pagamento,
  p_obs text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_nome text;
  v_id uuid;
begin
  perform public.exigir_dona_financeiro();

  select btrim(co.nome) into v_nome
  from public.colaboradores co
  where co.id = p_colaborador and co.ativo;
  if not found then
    raise exception 'Colaboradora não encontrada.' using errcode = 'P0001';
  end if;

  insert into public.contas_pagar (
    descricao, categoria, colaborador_id, valor_centavos, vencimento,
    status, pago_em, forma, lancada_por
  ) values (
    left('Vale — ' || v_nome || coalesce(' · ' || nullif(btrim(p_obs), ''), ''), 120),
    'vale', p_colaborador, p_valor_centavos, p_data,
    'paga', p_data, p_forma, public.colaborador_atual_id()
  )
  returning id into v_id;
  return v_id;
end;
$$;

revoke execute on function public.lancar_vale(uuid, int, date, public.forma_pagamento, text)
  from public, anon, authenticated;
grant execute on function public.lancar_vale(uuid, int, date, public.forma_pagamento, text)
  to authenticated;

-- p_inicio é levado ao 1º dia do mês. Categoria 'vale' → 23514.
create function public.criar_conta_fixa(
  p_descricao text,
  p_categoria public.categoria_despesa,
  p_fornecedor text,
  p_valor_centavos int,
  p_dia int,
  p_inicio date
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  perform public.exigir_dona_financeiro();

  insert into public.contas_fixas (
    descricao, categoria, fornecedor, valor_centavos, dia_vencimento, inicio, criado_por
  ) values (
    btrim(p_descricao), p_categoria, nullif(btrim(p_fornecedor), ''), p_valor_centavos,
    p_dia, date_trunc('month', p_inicio)::date, public.colaborador_atual_id()
  )
  returning id into v_id;
  return v_id;
end;
$$;

revoke execute on function public.criar_conta_fixa(
  text, public.categoria_despesa, text, int, int, date
) from public, anon, authenticated;
grant execute on function public.criar_conta_fixa(
  text, public.categoria_despesa, text, int, int, date
) to authenticated;

-- Para de gerar contas; as já geradas continuam como estão.
create function public.desativar_conta_fixa(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.exigir_dona_financeiro();

  update public.contas_fixas set ativa = false where id = p_id;
  if not found then
    raise exception 'Conta fixa não encontrada.' using errcode = 'P0001';
  end if;
end;
$$;

revoke execute on function public.desativar_conta_fixa(uuid) from public, anon, authenticated;
grant execute on function public.desativar_conta_fixa(uuid) to authenticated;

-- Para cada conta fixa ativa, cria a conta de cada competência de `inicio`
-- até o mês de p_ate (inclusive), em aberto. Vencimento = dia_vencimento ou
-- o último dia do mês. Idempotente (unique conta_fixa_id + competencia);
-- devolve quantas contas criou.
create function public.gerar_contas_fixas(p_ate date)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n int;
begin
  perform public.exigir_dona_financeiro();

  insert into public.contas_pagar (
    descricao, categoria, fornecedor, valor_centavos, vencimento,
    conta_fixa_id, competencia, lancada_por
  )
  select f.descricao, f.categoria, f.fornecedor, f.valor_centavos,
         least(
           m.competencia + (f.dia_vencimento - 1),
           (m.competencia + interval '1 month' - interval '1 day')::date
         ),
         f.id, m.competencia, public.colaborador_atual_id()
  from public.contas_fixas f
  cross join lateral (
    select g::date as competencia
    from generate_series(
      f.inicio::timestamp,
      date_trunc('month', p_ate::timestamp),
      interval '1 month'
    ) g
  ) m
  where f.ativa
  order by f.id, m.competencia
  on conflict (conta_fixa_id, competencia) do nothing;

  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke execute on function public.gerar_contas_fixas(date) from public, anon, authenticated;
grant execute on function public.gerar_contas_fixas(date) to authenticated;

-- =============================================================================
-- 3. Storage: bucket privado `financeiro` e políticas
--
-- Caminho contas_pagar/<uuid>.<jpg|png|pdf>; envio (pelo navegador, com o
-- JWT da dona) e leitura só da dona. Sem update/delete: nada é sobrescrito
-- nem apagado. (No Supabase real o RLS de storage.objects já está ligado.)
-- =============================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'financeiro', 'financeiro', false, 5242880,
  array['image/jpeg', 'image/png', 'application/pdf']
)
on conflict (id) do nothing;

create policy financeiro_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'financeiro'
    and (select public.perfil_atual()) = 'dona'
    and name ~ '^contas_pagar/[0-9a-f-]{36}\.(jpg|png|pdf)$'
  );

create policy financeiro_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'financeiro'
    and (select public.perfil_atual()) = 'dona'
    and name ~ '^contas_pagar/[0-9a-f-]{36}\.(jpg|png|pdf)$'
  );

-- =============================================================================
-- 4. Contas a receber manuais e recebimentos
--
-- contas_receber (0003) passa a aceitar contas lançadas pela dona sem
-- pagamento (origem_manual, parcela 1/1, com descrição). Cancelada ou
-- recebida, nunca as duas; nada é apagado.
-- recebimentos: uma baixa por parcela (unique), sempre no caixa de hoje
-- aberto; a forma é a do dinheiro que entrou (nunca 'a_receber').
-- =============================================================================
alter table public.contas_receber
  alter column pagamento_id drop not null,
  add column descricao text check (char_length(btrim(descricao)) between 1 and 120),
  add column origem_manual boolean not null default false,
  add column cancelada_motivo text check (char_length(cancelada_motivo) between 1 and 200),
  add column cancelada_em timestamptz,
  add column cancelada_por uuid references public.colaboradores (id),
  -- Quem lançou a conta manual (as de pagamento ficam nulas).
  add column lancada_por uuid references public.colaboradores (id),
  add constraint contas_receber_origem_check check (origem_manual = (pagamento_id is null)),
  add constraint contas_receber_manual_check check (
    not origem_manual or (descricao is not null and lancada_por is not null)
  ),
  add constraint contas_receber_cancelada_check check (
    (cancelada_em is null) = (cancelada_motivo is null)
    and (cancelada_em is null) = (cancelada_por is null)
  ),
  add constraint contas_receber_recebida_ou_cancelada_check check (
    recebido_em is null or cancelada_em is null
  );

create index contas_receber_cancelada_por_idx on public.contas_receber (cancelada_por);
create index contas_receber_lancada_por_idx on public.contas_receber (lancada_por);

create table public.recebimentos (
  id uuid primary key default gen_random_uuid(),
  conta_receber_id uuid not null unique references public.contas_receber (id),
  caixa_id uuid not null references public.caixas (id),
  forma public.forma_pagamento not null check (forma <> 'a_receber'),
  valor_centavos int not null check (valor_centavos > 0),
  recebido_por uuid not null references public.colaboradores (id),
  recebido_em timestamptz not null default now()
);

create index recebimentos_caixa_idx on public.recebimentos (caixa_id);
create index recebimentos_recebido_por_idx on public.recebimentos (recebido_por);
create index recebimentos_recebido_em_idx on public.recebimentos (recebido_em);

-- RLS: escrita só pelas funções abaixo; sem delete para ninguém.
alter table public.recebimentos enable row level security;

revoke all on public.recebimentos from anon, authenticated;
revoke delete, truncate on public.recebimentos, public.contas_receber from service_role;
-- Reforço explícito (0003 já tirou o truncate por padrão): nada é apagado.
revoke truncate on public.caixas, public.pagamentos, public.contas_receber from authenticated;
grant select on public.recebimentos to authenticated;

-- recebimentos: dona todos; recepção só os do caixa de hoje aberto.
create policy recebimentos_select on public.recebimentos
  for select to authenticated
  using (
    (select public.perfil_atual()) = 'dona'
    or (
      (select public.perfil_atual()) = 'recepcao'
      and caixa_id = (select public.caixa_aberto_hoje_id())
    )
  );

-- contas_receber: dona todas; recepção as em aberto já vencendo (para
-- receber) e as recebidas no caixa de hoje aberto; profissional nada.
drop policy contas_receber_select on public.contas_receber;
create policy contas_receber_select on public.contas_receber
  for select to authenticated
  using (
    (select public.perfil_atual()) = 'dona'
    or (
      (select public.perfil_atual()) = 'recepcao'
      and (
        (
          recebido_em is null
          and cancelada_em is null
          and vencimento <= (now() at time zone 'America/Sao_Paulo')::date
        )
        or exists (
          select 1 from public.recebimentos r
          where r.conta_receber_id = contas_receber.id
            and r.caixa_id = (select public.caixa_aberto_hoje_id())
        )
      )
    )
  );

-- Conta manual (dona): parcela 1/1 sem pagamento. Descrição vazia ou com
-- mais de 120 caracteres, valor <= 0 → 23514.
create function public.criar_conta_receber(
  p_cliente uuid,
  p_descricao text,
  p_valor_centavos int,
  p_vencimento date
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  perform public.exigir_dona_financeiro();
  if not exists (select 1 from public.clientes cl where cl.id = p_cliente) then
    raise exception 'Cliente não encontrada.' using errcode = 'P0001';
  end if;

  insert into public.contas_receber (
    cliente_id, descricao, origem_manual, numero, total_parcelas,
    valor_centavos, vencimento, lancada_por
  ) values (
    p_cliente, btrim(p_descricao), true, 1, 1,
    p_valor_centavos, p_vencimento, public.colaborador_atual_id()
  )
  returning id into v_id;
  return v_id;
end;
$$;

revoke execute on function public.criar_conta_receber(uuid, text, int, date)
  from public, anon, authenticated;
grant execute on function public.criar_conta_receber(uuid, text, int, date) to authenticated;

-- Só em aberto (manual ou parcela de pagamento). Motivo com trim: vazio →
-- P0001; mais de 200 caracteres → 23514.
create function public.cancelar_conta_receber(p_conta uuid, p_motivo text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_motivo text := nullif(btrim(p_motivo), '');
  v_conta public.contas_receber;
begin
  perform public.exigir_dona_financeiro();
  if v_motivo is null then
    raise exception 'Informe o motivo do cancelamento.' using errcode = 'P0001';
  end if;

  select * into v_conta from public.contas_receber c where c.id = p_conta for update;
  if not found then
    raise exception 'Conta não encontrada.' using errcode = 'P0001';
  elsif v_conta.cancelada_em is not null then
    raise exception 'Esta conta foi cancelada.' using errcode = 'P0001';
  elsif v_conta.recebido_em is not null then
    raise exception 'Esta parcela já foi recebida.' using errcode = 'P0001';
  end if;

  update public.contas_receber
  set cancelada_motivo = v_motivo,
      cancelada_em = now(),
      cancelada_por = public.colaborador_atual_id()
  where id = p_conta;
end;
$$;

revoke execute on function public.cancelar_conta_receber(uuid, text)
  from public, anon, authenticated;
grant execute on function public.cancelar_conta_receber(uuid, text) to authenticated;

-- Baixa da parcela no caixa de hoje aberto (dona/recepção), pelo valor da
-- parcela. Devolve o id do recebimento. Forma 'a_receber' → 23514.
create function public.receber_parcela(p_conta uuid, p_forma public.forma_pagamento)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_caixa uuid;
  v_conta public.contas_receber;
  v_id uuid;
begin
  if public.perfil_atual() is distinct from 'dona'
     and public.perfil_atual() is distinct from 'recepcao' then
    raise exception 'Apenas a dona ou a recepção podem receber parcelas.'
      using errcode = 'P0001';
  end if;

  -- Trava o caixa contra um fechamento simultâneo (fechar_caixa usa FOR UPDATE).
  select c.id into v_caixa
  from public.caixas c
  where c.data = v_hoje and c.fechado_em is null
  for share;
  if v_caixa is null then
    raise exception 'Abra o caixa do dia antes de receber.' using errcode = 'P0001';
  end if;

  -- FOR UPDATE: duas baixas simultâneas da mesma parcela esperam uma pela outra.
  select * into v_conta from public.contas_receber c where c.id = p_conta for update;
  -- A recepção só enxerga (RLS) parcelas vencendo até hoje: a mesma regra aqui.
  if not found
     or (public.perfil_atual() is distinct from 'dona' and v_conta.vencimento > v_hoje) then
    raise exception 'Conta não encontrada.' using errcode = 'P0001';
  elsif v_conta.cancelada_em is not null then
    raise exception 'Esta conta foi cancelada.' using errcode = 'P0001';
  elsif v_conta.recebido_em is not null then
    raise exception 'Esta parcela já foi recebida.' using errcode = 'P0001';
  end if;

  begin
    insert into public.recebimentos (
      conta_receber_id, caixa_id, forma, valor_centavos, recebido_por
    ) values (
      p_conta, v_caixa, p_forma, v_conta.valor_centavos, public.colaborador_atual_id()
    )
    returning id into v_id;
  exception when unique_violation then
    raise exception 'Esta parcela já foi recebida.' using errcode = 'P0001';
  end;

  update public.contas_receber set recebido_em = now() where id = p_conta;
  return v_id;
end;
$$;

revoke execute on function public.receber_parcela(uuid, public.forma_pagamento)
  from public, anon, authenticated;
grant execute on function public.receber_parcela(uuid, public.forma_pagamento)
  to authenticated;

-- =============================================================================
-- 5. fechar_caixa com recebimentos
--
-- Mesma assinatura, regras e retorno de 0003. Entradas do caixa por forma =
-- pagamentos (valor − desconto), exceto 'a_receber' (dinheiro que ainda não
-- entrou), + recebimentos de parcelas do caixa. total_por_forma.a_receber
-- fica sempre 0; dinheiro esperado inclui as parcelas recebidas em dinheiro.
-- =============================================================================
create or replace function public.fechar_caixa(p_caixa uuid, p_valor_contado_centavos int)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_perfil public.perfil := public.perfil_atual();
  v_caixa public.caixas;
  v_por_forma jsonb;
  v_total_geral bigint;
  v_dinheiro bigint;
  v_esperado bigint;
  v_diferenca bigint;
begin
  if v_perfil is null or v_perfil not in ('dona', 'recepcao') then
    raise exception 'Apenas a dona ou a recepção podem fechar o caixa'
      using errcode = 'P0001';
  end if;
  if p_valor_contado_centavos is null or p_valor_contado_centavos < 0 then
    raise exception 'O valor contado não pode ser negativo'
      using errcode = 'P0001';
  end if;

  -- FOR UPDATE: espera lançamentos e recebimentos em andamento e bloqueia novos.
  select * into v_caixa from public.caixas c where c.id = p_caixa for update;
  if not found then
    raise exception 'Caixa não encontrado' using errcode = 'P0001';
  end if;
  if v_perfil = 'recepcao' and v_caixa.data <> v_hoje then
    raise exception 'A recepção só pode fechar o caixa de hoje'
      using errcode = 'P0001';
  end if;
  if v_caixa.fechado_em is not null then
    raise exception 'Este caixa já foi fechado' using errcode = 'P0001';
  end if;

  with entradas as (
    select p.forma, p.valor_centavos - p.desconto_centavos as valor
    from public.pagamentos p
    where p.caixa_id = v_caixa.id and p.forma <> 'a_receber'
    union all
    select r.forma, r.valor_centavos
    from public.recebimentos r
    where r.caixa_id = v_caixa.id
  ),
  por_forma as (
    select f.forma, coalesce(sum(e.valor), 0) as total
    from unnest(enum_range(null::public.forma_pagamento)) as f (forma)
    left join entradas e on e.forma = f.forma
    group by f.forma
  )
  select jsonb_object_agg(pf.forma::text, pf.total), sum(pf.total)
  into v_por_forma, v_total_geral
  from por_forma pf;

  v_dinheiro := (v_por_forma ->> 'dinheiro')::bigint;
  v_esperado := v_caixa.valor_inicial_centavos + v_dinheiro;
  v_diferenca := p_valor_contado_centavos - v_esperado;

  update public.caixas
  set fechado_por = public.colaborador_atual_id(),
      fechado_em = now(),
      valor_contado_centavos = p_valor_contado_centavos,
      diferenca_centavos = v_diferenca
  where id = v_caixa.id;

  return jsonb_build_object(
    'total_por_forma', v_por_forma,
    'total_geral', v_total_geral,
    'dinheiro_esperado', v_esperado,
    'diferenca', v_diferenca
  );
end;
$$;

-- =============================================================================
-- 6. Resumo, fluxo de caixa, avisos lidos e relatórios gerados (só a dona)
--
-- Período P = [p_de, p_ate], dias de São Paulo. Ruling P4-R1:
--   entradas = pagamentos (valor − desconto, exceto 'a_receber') pela data do
--              caixa + recebimentos de parcelas por recebido_em em SP;
--   saídas   = contas_pagar pagas, por pago_em.
-- Assim a parcela "a receber" entra uma vez só: quando é recebida.
-- =============================================================================

create function public.exigir_dona_leitura_financeiro()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if public.perfil_atual() is distinct from 'dona' then
    raise exception 'Acesso não autorizado' using errcode = 'P0001';
  end if;
end;
$$;

revoke execute on function public.exigir_dona_leitura_financeiro()
  from public, anon, authenticated, service_role;

-- Entradas de dinheiro em P (uma linha por pagamento/recebimento, valor > 0).
-- Uso interno: só as funções abaixo (que já conferiram a dona) chamam.
create function public.entradas_financeiro(p_de date, p_ate date)
returns table (dia date, forma public.forma_pagamento, valor bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select cx.data, p.forma, (p.valor_centavos - p.desconto_centavos)::bigint
  from public.pagamentos p
  join public.caixas cx on cx.id = p.caixa_id
  where cx.data between p_de and p_ate
    and p.forma <> 'a_receber'
    and p.valor_centavos > p.desconto_centavos
  union all
  select (r.recebido_em at time zone 'America/Sao_Paulo')::date, r.forma, r.valor_centavos::bigint
  from public.recebimentos r
  where r.recebido_em >= (p_de::timestamp at time zone 'America/Sao_Paulo')
    and r.recebido_em < ((p_ate + 1)::timestamp at time zone 'America/Sao_Paulo')
$$;

revoke execute on function public.entradas_financeiro(date, date)
  from public, anon, authenticated, service_role;

-- Os cartões do painel. Saldo em caixa (recebido − pago) e projetado
-- (+ a_receber − a_pagar) são calculados na tela. a_receber_vencido /
-- a_pagar_vencido: a parte de a_receber / a_pagar (em aberto, vencimento em P)
-- com vencimento < hoje. Vencidos: contas em aberto (pagar + receber) com
-- vencimento < hoje (SP), qualquer que seja P.
create function public.resumo_financeiro(p_de date, p_ate date)
returns table (
  recebido bigint,
  recebido_qtd int,
  pago bigint,
  pago_qtd int,
  a_receber bigint,
  ja_recebido bigint,
  a_pagar bigint,
  ja_pago bigint,
  a_receber_vencido bigint,
  a_pagar_vencido bigint,
  vencidos_qtd int,
  vencidos_total bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  perform public.exigir_dona_leitura_financeiro();

  return query
  with
  ent as (
    select coalesce(sum(e.valor), 0)::bigint as total, count(*)::int as qtd
    from public.entradas_financeiro(p_de, p_ate) e
  ),
  pag as (
    select coalesce(sum(cp.valor_centavos), 0)::bigint as total, count(*)::int as qtd
    from public.contas_pagar cp
    where cp.status = 'paga' and cp.pago_em between p_de and p_ate
  ),
  rec_venc as (
    select
      coalesce(sum(cr.valor_centavos) filter (where cr.recebido_em is null), 0)::bigint as aberto,
      coalesce(sum(cr.valor_centavos) filter (where cr.recebido_em is not null), 0)::bigint as feito,
      coalesce(sum(cr.valor_centavos) filter (
        where cr.recebido_em is null and cr.vencimento < v_hoje
      ), 0)::bigint as vencido
    from public.contas_receber cr
    where cr.cancelada_em is null and cr.vencimento between p_de and p_ate
  ),
  pag_venc as (
    select
      coalesce(sum(cp.valor_centavos) filter (where cp.status = 'aberta'), 0)::bigint as aberto,
      coalesce(sum(cp.valor_centavos) filter (where cp.status = 'paga'), 0)::bigint as feito,
      coalesce(sum(cp.valor_centavos) filter (
        where cp.status = 'aberta' and cp.vencimento < v_hoje
      ), 0)::bigint as vencido
    from public.contas_pagar cp
    where cp.status <> 'cancelada' and cp.vencimento between p_de and p_ate
  ),
  venc as (
    select count(*)::int as qtd, coalesce(sum(v.valor), 0)::bigint as total
    from (
      select cp.valor_centavos as valor
      from public.contas_pagar cp
      where cp.status = 'aberta' and cp.vencimento < v_hoje
      union all
      select cr.valor_centavos
      from public.contas_receber cr
      where cr.recebido_em is null and cr.cancelada_em is null and cr.vencimento < v_hoje
    ) v
  )
  select ent.total, ent.qtd, pag.total, pag.qtd,
         rec_venc.aberto, rec_venc.feito, pag_venc.aberto, pag_venc.feito,
         rec_venc.vencido, pag_venc.vencido,
         venc.qtd, venc.total
  from ent, pag, rec_venc, pag_venc, venc;
end;
$$;

revoke execute on function public.resumo_financeiro(date, date) from public, anon, authenticated;
grant execute on function public.resumo_financeiro(date, date) to authenticated;

-- Entradas e saídas por dia ou por mês (periodo = 1º dia do mês); só os
-- períodos com movimento, em ordem.
create function public.fluxo_caixa(p_de date, p_ate date, p_agrupar text)
returns table (periodo date, entradas bigint, saidas bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.exigir_dona_leitura_financeiro();
  if p_agrupar is null or p_agrupar not in ('dia', 'mes') then
    raise exception 'Agrupamento inválido.' using errcode = 'P0001';
  end if;

  return query
  with mov as (
    select e.dia, e.valor as entrada, 0::bigint as saida
    from public.entradas_financeiro(p_de, p_ate) e
    union all
    select cp.pago_em, 0::bigint, cp.valor_centavos::bigint
    from public.contas_pagar cp
    where cp.status = 'paga' and cp.pago_em between p_de and p_ate
  )
  select case when p_agrupar = 'mes' then date_trunc('month', m.dia)::date else m.dia end as per,
         sum(m.entrada)::bigint, sum(m.saida)::bigint
  from mov m
  group by per
  order by per;
end;
$$;

revoke execute on function public.fluxo_caixa(date, date, text) from public, anon, authenticated;
grant execute on function public.fluxo_caixa(date, date, text) to authenticated;

-- Entradas de P por forma (só as que tiveram movimento), maior primeiro.
create function public.fluxo_por_forma(p_de date, p_ate date)
returns table (forma public.forma_pagamento, total bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.exigir_dona_leitura_financeiro();

  return query
  select e.forma, sum(e.valor)::bigint as t
  from public.entradas_financeiro(p_de, p_ate) e
  group by e.forma
  order by t desc, e.forma;
end;
$$;

revoke execute on function public.fluxo_por_forma(date, date) from public, anon, authenticated;
grant execute on function public.fluxo_por_forma(date, date) to authenticated;

-- Contas pagas em P (por pago_em) por categoria, maior primeiro.
create function public.despesas_por_categoria(p_de date, p_ate date)
returns table (categoria public.categoria_despesa, total bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.exigir_dona_leitura_financeiro();

  return query
  select cp.categoria, sum(cp.valor_centavos)::bigint as t
  from public.contas_pagar cp
  where cp.status = 'paga' and cp.pago_em between p_de and p_ate
  group by cp.categoria
  order by t desc, cp.categoria;
end;
$$;

revoke execute on function public.despesas_por_categoria(date, date)
  from public, anon, authenticated;
grant execute on function public.despesas_por_categoria(date, date) to authenticated;

-- Avisos de vencimento marcados como lidos (o aviso em si é calculado na
-- leitura). Chave: '<pagar|receber>:<id>:<d>' ou '…:vencida:<AAAA-MM-DD>'.
create table public.avisos_lidos (
  colaborador_id uuid not null references public.colaboradores (id),
  chave text not null check (char_length(chave) between 1 and 120),
  lido_em timestamptz not null default now(),
  primary key (colaborador_id, chave)
);

-- PDFs exportados (quem, qual aba, qual período).
create table public.relatorios_gerados (
  id uuid primary key default gen_random_uuid(),
  colaborador_id uuid not null references public.colaboradores (id),
  aba text not null check (char_length(aba) between 1 and 40),
  de date not null,
  ate date not null,
  gerado_em timestamptz not null default now(),
  constraint relatorios_gerados_periodo_check check (de <= ate)
);

create index relatorios_gerados_colaborador_idx on public.relatorios_gerados (colaborador_id);

-- RLS: escrita só pelas funções abaixo; sem update/delete para ninguém.
alter table public.avisos_lidos enable row level security;
alter table public.relatorios_gerados enable row level security;

revoke all on public.avisos_lidos, public.relatorios_gerados from anon, authenticated;
revoke delete, truncate on public.avisos_lidos, public.relatorios_gerados from service_role;
grant select on public.avisos_lidos, public.relatorios_gerados to authenticated;

create policy avisos_lidos_select on public.avisos_lidos
  for select to authenticated
  using (
    (select public.perfil_atual()) = 'dona'
    and colaborador_id = (select public.colaborador_atual_id())
  );

create policy relatorios_gerados_select on public.relatorios_gerados
  for select to authenticated
  using ((select public.perfil_atual()) = 'dona');

-- Idempotente; reler uma chave já marcada renova lido_em (o sino só vale as lidas hoje).
-- Nulos e repetidas são ignoradas.
-- Chave vazia ou com mais de 120 caracteres → 23514.
create function public.marcar_avisos_lidos(p_chaves text[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.exigir_dona_leitura_financeiro();

  insert into public.avisos_lidos (colaborador_id, chave)
  select distinct public.colaborador_atual_id(), k.chave
  from unnest(p_chaves) as k (chave)
  where k.chave is not null
  on conflict (colaborador_id, chave) do update set lido_em = now();
end;
$$;

revoke execute on function public.marcar_avisos_lidos(text[]) from public, anon, authenticated;
grant execute on function public.marcar_avisos_lidos(text[]) to authenticated;

-- Aba vazia ou com mais de 40 caracteres, de > ate → 23514.
create function public.registrar_relatorio(p_aba text, p_de date, p_ate date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.exigir_dona_leitura_financeiro();

  insert into public.relatorios_gerados (colaborador_id, aba, de, ate)
  values (public.colaborador_atual_id(), p_aba, p_de, p_ate);
end;
$$;

revoke execute on function public.registrar_relatorio(text, date, date)
  from public, anon, authenticated;
grant execute on function public.registrar_relatorio(text, date, date) to authenticated;
