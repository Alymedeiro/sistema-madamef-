-- =============================================================================
-- 0003_caixa — caixa do dia, pagamentos e contas a receber (Fase 1, Task 5)
--
-- Tabelas: caixas, pagamentos, contas_receber (spec 5.6 / 6.4).
--
-- Modelo de escrita: NINGUÉM insere, altera ou exclui direto nestas tabelas
-- (sem políticas de escrita e sem os privilégios de tabela). Toda escrita passa
-- pelas funções security definer abaixo, que exigem perfil dona ou recepção:
--   abrir_caixa, registrar_pagamento, fechar_caixa.
-- Leitura: dona vê tudo; recepção só o caixa de HOJE ainda ABERTO e os
-- pagamentos dele; contas a receber só a dona; profissional nada.
--
-- "Hoje" é sempre (now() at time zone 'America/Sao_Paulo')::date.
-- Valores sempre em centavos (int). Totais de caixa são líquidos de desconto.
--
-- Também nesta migração (Ruling R11):
--   * guarda da profissional em agendamentos: status final (atendido, faltou,
--     cancelado) não pode mais ser alterado por ela;
--   * TRUNCATE revogado de anon e authenticated em todas as tabelas públicas,
--     inclusive as futuras (default privileges).
--
-- Dependências: 0001_base (perfil_atual, colaborador_atual_id,
-- set_atualizado_em, clientes, colaboradores), 0002_agenda (agendamentos,
-- agendamentos_guarda_profissional).
-- =============================================================================

-- Tipos ----------------------------------------------------------------------
create type public.forma_pagamento as enum (
  'pix', 'dinheiro', 'debito', 'credito', 'credito_parcelado', 'a_receber'
);
create type public.origem_pagamento as enum ('agendamento', 'pacote', 'venda_produto');

-- =============================================================================
-- 5.6 Financeiro — caixa do dia
-- =============================================================================

create table public.caixas (
  id uuid primary key default gen_random_uuid(),
  -- Data do caixa no fuso de São Paulo; um caixa por dia.
  data date not null,
  aberto_por uuid not null references public.colaboradores (id),
  aberto_em timestamptz not null default now(),
  valor_inicial_centavos int not null check (valor_inicial_centavos >= 0),
  fechado_por uuid references public.colaboradores (id),
  fechado_em timestamptz,
  valor_contado_centavos int check (valor_contado_centavos >= 0),
  -- valor contado − dinheiro esperado (negativo = faltou dinheiro).
  diferenca_centavos int,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  constraint caixas_data_key unique (data),
  -- Fechamento é tudo ou nada.
  constraint caixas_fechamento_check check (
    (fechado_em is null) = (fechado_por is null)
    and (fechado_em is null) = (valor_contado_centavos is null)
    and (fechado_em is null) = (diferenca_centavos is null)
  )
);

create table public.pagamentos (
  id uuid primary key default gen_random_uuid(),
  caixa_id uuid not null references public.caixas (id),
  cliente_id uuid not null references public.clientes (id),
  origem public.origem_pagamento not null,
  agendamento_id uuid references public.agendamentos (id),
  forma public.forma_pagamento not null,
  parcelas int not null default 1 check (parcelas >= 1),
  valor_centavos int not null check (valor_centavos > 0),
  desconto_centavos int not null default 0 check (desconto_centavos >= 0),
  lancado_por uuid not null references public.colaboradores (id),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  constraint pagamentos_desconto_check check (desconto_centavos <= valor_centavos),
  constraint pagamentos_origem_agendamento_check
    check ((origem = 'agendamento') = (agendamento_id is not null)),
  -- Só crédito parcelado e "a receber" têm mais de uma parcela.
  constraint pagamentos_parcelas_forma_check
    check (parcelas = 1 or forma in ('credito_parcelado', 'a_receber'))
);
create index pagamentos_caixa_idx on public.pagamentos (caixa_id);
create index pagamentos_agendamento_idx on public.pagamentos (agendamento_id)
  where agendamento_id is not null;
create index pagamentos_cliente_idx on public.pagamentos (cliente_id);

create table public.contas_receber (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references public.clientes (id),
  pagamento_id uuid not null references public.pagamentos (id),
  -- Parcela numero/total_parcelas.
  numero int not null,
  total_parcelas int not null check (total_parcelas >= 1),
  valor_centavos int not null check (valor_centavos > 0),
  vencimento date not null,
  recebido_em timestamptz,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  constraint contas_receber_numero_check check (numero between 1 and total_parcelas),
  constraint contas_receber_parcela_unica unique (pagamento_id, numero)
);
create index contas_receber_cliente_idx on public.contas_receber (cliente_id);
create index contas_receber_em_aberto_idx on public.contas_receber (vencimento)
  where recebido_em is null;

create trigger caixas_atualizado_em before update on public.caixas
  for each row execute function public.set_atualizado_em();
create trigger pagamentos_atualizado_em before update on public.pagamentos
  for each row execute function public.set_atualizado_em();
create trigger contas_receber_atualizado_em before update on public.contas_receber
  for each row execute function public.set_atualizado_em();

-- =============================================================================
-- Funções
-- =============================================================================

-- Id do caixa de hoje ainda aberto, para dona/recepção; null caso contrário.
-- Usada pelas políticas de leitura da recepção.
create function public.caixa_aberto_hoje_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select c.id
  from public.caixas c
  where c.data = (now() at time zone 'America/Sao_Paulo')::date
    and c.fechado_em is null
    and public.perfil_atual() in ('dona', 'recepcao')
$$;

-- Abre o caixa de hoje com o troco inicial em dinheiro.
create function public.abrir_caixa(p_valor_inicial_centavos int)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_id uuid;
begin
  if public.perfil_atual() is distinct from 'dona'
     and public.perfil_atual() is distinct from 'recepcao' then
    raise exception 'Apenas a dona ou a recepção podem operar o caixa'
      using errcode = 'P0001';
  end if;
  if p_valor_inicial_centavos is null or p_valor_inicial_centavos < 0 then
    raise exception 'O valor inicial do caixa não pode ser negativo'
      using errcode = 'P0001';
  end if;
  if exists (select 1 from public.caixas c where c.data = v_hoje) then
    raise exception 'Já existe caixa para hoje' using errcode = 'P0001';
  end if;

  begin
    insert into public.caixas (data, aberto_por, valor_inicial_centavos)
    values (v_hoje, public.colaborador_atual_id(), p_valor_inicial_centavos)
    returning id into v_id;
  exception when unique_violation then
    -- Duas aberturas simultâneas: a segunda perde.
    raise exception 'Já existe caixa para hoje' using errcode = 'P0001';
  end;
  return v_id;
end;
$$;

-- Lança um pagamento no caixa de hoje (que precisa estar aberto).
-- Origem: 'agendamento' quando p_agendamento é informado; senão
-- 'venda_produto' (pacotes ainda não existem nesta fase).
-- Forma 'a_receber': uma conta a receber por parcela, com os vencimentos e
-- valores informados, cuja soma deve ser o valor líquido (valor − desconto).
-- Nas demais formas p_vencimentos/p_valores_parcelas são ignorados;
-- 'credito_parcelado' só guarda o número de parcelas (considerado recebido).
create function public.registrar_pagamento(
  p_cliente uuid,
  p_agendamento uuid,
  p_forma public.forma_pagamento,
  p_valor_centavos int,
  p_desconto_centavos int,
  p_parcelas int,
  p_vencimentos date[],
  p_valores_parcelas int[]
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_desconto int := coalesce(p_desconto_centavos, 0);
  v_parcelas int := coalesce(p_parcelas, 1);
  v_caixa uuid;
  v_cliente_agendamento uuid;
  v_id uuid;
begin
  if public.perfil_atual() is distinct from 'dona'
     and public.perfil_atual() is distinct from 'recepcao' then
    raise exception 'Apenas a dona ou a recepção podem lançar pagamentos'
      using errcode = 'P0001';
  end if;

  -- Trava o caixa contra um fechamento simultâneo (fechar_caixa usa FOR UPDATE).
  select c.id into v_caixa
  from public.caixas c
  where c.data = v_hoje and c.fechado_em is null
  for share;
  if v_caixa is null then
    raise exception 'Abra o caixa do dia antes de lançar pagamentos'
      using errcode = 'P0001';
  end if;

  if p_cliente is null
     or not exists (select 1 from public.clientes cl where cl.id = p_cliente) then
    raise exception 'Cliente não encontrada' using errcode = 'P0001';
  end if;
  if p_agendamento is not null then
    select a.cliente_id into v_cliente_agendamento
    from public.agendamentos a
    where a.id = p_agendamento;
    if not found then
      raise exception 'Agendamento não encontrado' using errcode = 'P0001';
    end if;
    if v_cliente_agendamento <> p_cliente then
      raise exception 'O agendamento é de outra cliente' using errcode = 'P0001';
    end if;
  end if;

  if p_forma is null then
    raise exception 'Informe a forma de pagamento' using errcode = 'P0001';
  end if;
  if p_valor_centavos is null or p_valor_centavos <= 0 then
    raise exception 'O valor do pagamento deve ser maior que zero'
      using errcode = 'P0001';
  end if;
  if v_desconto < 0 or v_desconto > p_valor_centavos then
    raise exception 'O desconto deve estar entre zero e o valor do pagamento'
      using errcode = 'P0001';
  end if;
  if v_parcelas < 1 then
    raise exception 'O número de parcelas deve ser pelo menos 1'
      using errcode = 'P0001';
  end if;
  if v_parcelas > 1 and p_forma not in ('credito_parcelado', 'a_receber') then
    raise exception 'Só crédito parcelado ou a receber podem ter mais de uma parcela'
      using errcode = 'P0001';
  end if;

  if p_forma = 'a_receber' then
    if p_vencimentos is null or p_valores_parcelas is null
       or cardinality(p_vencimentos) <> v_parcelas
       or cardinality(p_valores_parcelas) <> v_parcelas then
      raise exception 'Informe um vencimento e um valor para cada parcela'
        using errcode = 'P0001';
    end if;
    if array_position(p_vencimentos, null) is not null
       or array_position(p_valores_parcelas, null) is not null then
      raise exception 'Informe um vencimento e um valor para cada parcela'
        using errcode = 'P0001';
    end if;
    if exists (select 1 from unnest(p_valores_parcelas) as v (valor) where v.valor <= 0) then
      raise exception 'Cada parcela deve ter valor maior que zero'
        using errcode = 'P0001';
    end if;
    if (select sum(v.valor) from unnest(p_valores_parcelas) as v (valor))
       <> p_valor_centavos - v_desconto then
      raise exception 'A soma das parcelas deve ser igual ao valor com desconto'
        using errcode = 'P0001';
    end if;
  end if;

  insert into public.pagamentos (
    caixa_id, cliente_id, origem, agendamento_id, forma, parcelas,
    valor_centavos, desconto_centavos, lancado_por
  )
  values (
    v_caixa,
    p_cliente,
    case when p_agendamento is not null
      then 'agendamento'::public.origem_pagamento
      else 'venda_produto'::public.origem_pagamento
    end,
    p_agendamento,
    p_forma,
    v_parcelas,
    p_valor_centavos,
    v_desconto,
    public.colaborador_atual_id()
  )
  returning id into v_id;

  if p_forma = 'a_receber' then
    insert into public.contas_receber (
      cliente_id, pagamento_id, numero, total_parcelas, valor_centavos, vencimento
    )
    select p_cliente, v_id, u.numero::int, v_parcelas, u.valor, u.vencimento
    from unnest(p_vencimentos, p_valores_parcelas)
      with ordinality as u (vencimento, valor, numero);
  end if;

  return v_id;
end;
$$;

-- Fecha um caixa: totais por forma (líquidos de desconto), dinheiro esperado
-- (troco inicial + dinheiro recebido) e diferença para o valor contado.
-- Dona fecha caixa de qualquer data; recepção só o de hoje.
create function public.fechar_caixa(p_caixa uuid, p_valor_contado_centavos int)
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

  -- FOR UPDATE: espera lançamentos em andamento e bloqueia novos.
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

  select jsonb_object_agg(f.forma::text, coalesce(t.total, 0))
  into v_por_forma
  from unnest(enum_range(null::public.forma_pagamento)) as f (forma)
  left join (
    select p.forma, sum(p.valor_centavos - p.desconto_centavos) as total
    from public.pagamentos p
    where p.caixa_id = v_caixa.id
    group by p.forma
  ) t on t.forma = f.forma;

  select coalesce(sum(p.valor_centavos - p.desconto_centavos), 0)
  into v_total_geral
  from public.pagamentos p
  where p.caixa_id = v_caixa.id;

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

-- Caixa de hoje visível para quem chama; null se não houver.
-- security invoker: o RLS de caixas decide (dona vê aberto ou fechado;
-- recepção só aberto; profissional nunca).
-- Atenção (PostgREST): função não-SETOF de tipo composto devolve um objeto
-- com todos os campos nulos quando não há caixa — teste `id === null`.
create function public.caixa_de_hoje()
returns public.caixas
language sql
stable
security invoker
set search_path = ''
as $$
  select c.*
  from public.caixas c
  where c.data = (now() at time zone 'America/Sao_Paulo')::date
$$;

-- Atendimentos do dia p_data (fuso de São Paulo) com status 'atendido', sem
-- nenhum pagamento lançado e fora de pacote. Só para dona/recepção.
-- security definer: a recepção não enxerga pagamentos de caixas anteriores.
create function public.agendamentos_sem_pagamento(p_data date)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select a.id
  from public.agendamentos a
  where public.perfil_atual() in ('dona', 'recepcao')
    and a.status = 'atendido'
    and a.pacote_vendido_id is null
    and a.inicio >= (p_data::timestamp at time zone 'America/Sao_Paulo')
    and a.inicio < ((p_data + 1)::timestamp at time zone 'America/Sao_Paulo')
    and not exists (
      select 1 from public.pagamentos p where p.agendamento_id = a.id
    )
  order by a.inicio
$$;

revoke execute on function public.caixa_aberto_hoje_id() from public, anon;
revoke execute on function public.abrir_caixa(int) from public, anon;
revoke execute on function public.registrar_pagamento(
  uuid, uuid, public.forma_pagamento, int, int, int, date[], int[]
) from public, anon;
revoke execute on function public.fechar_caixa(uuid, int) from public, anon;
revoke execute on function public.caixa_de_hoje() from public, anon;
revoke execute on function public.agendamentos_sem_pagamento(date) from public, anon;
grant execute on function public.caixa_aberto_hoje_id() to authenticated;
grant execute on function public.abrir_caixa(int) to authenticated;
grant execute on function public.registrar_pagamento(
  uuid, uuid, public.forma_pagamento, int, int, int, date[], int[]
) to authenticated;
grant execute on function public.fechar_caixa(uuid, int) to authenticated;
grant execute on function public.caixa_de_hoje() to authenticated;
grant execute on function public.agendamentos_sem_pagamento(date) to authenticated;

-- =============================================================================
-- RLS e privilégios
-- =============================================================================
alter table public.caixas enable row level security;
alter table public.pagamentos enable row level security;
alter table public.contas_receber enable row level security;

-- Escrita só pelas funções acima: sem privilégio de escrita direta (42501).
revoke all on table public.caixas, public.pagamentos, public.contas_receber from anon;
revoke insert, update, delete on table
  public.caixas, public.pagamentos, public.contas_receber
  from authenticated;

-- caixas: dona todos; recepção só o de hoje aberto.
create policy caixas_select on public.caixas
  for select to authenticated
  using (
    (select public.perfil_atual()) = 'dona'
    or (
      (select public.perfil_atual()) = 'recepcao'
      and id = (select public.caixa_aberto_hoje_id())
    )
  );

-- pagamentos: dona todos; recepção só os do caixa de hoje aberto.
create policy pagamentos_select on public.pagamentos
  for select to authenticated
  using (
    (select public.perfil_atual()) = 'dona'
    or (
      (select public.perfil_atual()) = 'recepcao'
      and caixa_id = (select public.caixa_aberto_hoje_id())
    )
  );

-- contas_receber: só a dona.
create policy contas_receber_select on public.contas_receber
  for select to authenticated
  using ((select public.perfil_atual()) = 'dona');

-- =============================================================================
-- R11 (a): guarda da profissional — status final é definitivo para ela.
-- Mesma assinatura e grants de 0002; só o corpo muda.
-- =============================================================================
create or replace function public.agendamentos_guarda_profissional()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select public.perfil_atual()) = 'profissional' then
    if (to_jsonb(new) - 'status' - 'atualizado_em')
         is distinct from (to_jsonb(old) - 'status' - 'atualizado_em') then
      raise exception 'Profissional só pode alterar o status do próprio atendimento'
        using errcode = 'P0001';
    end if;
    if old.status not in ('pendente', 'confirmado') then
      raise exception 'Status final: só a dona ou a recepção podem alterar este agendamento'
        using errcode = 'P0001';
    end if;
    if new.status not in ('confirmado', 'atendido', 'faltou') then
      raise exception 'Profissional só pode alterar o status do próprio atendimento'
        using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;

-- =============================================================================
-- R11 (b): ninguém trunca tabelas pelo papel da API (nem as futuras).
-- =============================================================================
revoke truncate on all tables in schema public from anon, authenticated;
alter default privileges in schema public
  revoke truncate on tables from anon, authenticated;
