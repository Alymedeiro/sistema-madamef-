-- =============================================================================
-- 0010_financeiro — Fase 4: Financeiro
--
--   1. Contas a pagar e contas fixas: tipos, tabelas e RLS (só a dona lê;
--      escrita só pelas funções security definer; nada é apagado).
--   2. Funções da dona: criar, editar, pagar e cancelar conta a pagar, lançar
--      vale, criar/desativar conta fixa e gerar as contas fixas do período.
--   3. Bucket privado `financeiro` (anexos das contas a pagar) e políticas em
--      storage.objects (só a dona envia e lê).
--   (Seções seguintes: Tasks 2–3 da Fase 4.)
--
-- Toda função recusa quem não é a dona com 'Apenas a dona pode lançar
-- contas.' (P0001).
--
-- Dependências: 0001_base (colaboradores, perfil_atual, colaborador_atual_id,
-- set_atualizado_em), 0003_caixa (forma_pagamento).
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

-- Vale: despesa já paga em p_data, categoria 'vale', ligada à colaboradora.
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

  select btrim(co.nome) into v_nome from public.colaboradores co where co.id = p_colaborador;
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
