-- =============================================================================
-- 0007_pacotes_cobranca — pacotes de sessões e cobrança com pagamento dividido
-- (Fase 2, Task 2)
--
--   1. pacotes_vendidos: venda de N sessões de um serviço; agendamentos ganham
--      FK para o pacote. O consumo é feito por gatilho em agendamentos, com o
--      pacote travado (FOR UPDATE): dois atendimentos da última sessão ao mesmo
--      tempo → só um consome.
--   2. cobrancas: UMA por atendimento e UMA por pacote (unique no banco: duplo
--      toque ou duas recepcionistas → 23505). Cada parte (forma) da cobrança é
--      uma linha de pagamentos com desconto 0 (o desconto fica na cobrança),
--      então fechar_caixa (soma valor − desconto por forma) não muda.
--      Os pagamentos da Fase 1 viram uma cobrança cada, com o mesmo id.
--   3. RPCs: registrar_cobranca, vender_pacote, cancelar_pacote,
--      expirar_pacotes; registrar_pagamento (atalho de uma parte) e as listas
--      de "sem pagamento" passam a usar cobrancas.
--
-- Escrita só pelas funções security definer; ninguém apaga pacotes nem
-- cobranças (sem privilégio de delete). "Hoje" = data de São Paulo.
--
-- Dependências: 0001_base (perfil_atual, colaborador_atual_id,
-- set_atualizado_em, clientes, colaboradores, servicos), 0002_agenda
-- (agendamentos, agendamentos_guarda_profissional), 0003_caixa (caixas,
-- pagamentos, contas_receber, caixa_aberto_hoje_id), 0005_pagamento_unico,
-- 0006_ficha_clinica (acesso_clinico).
-- =============================================================================

create type public.status_pacote as enum ('ativo', 'concluido', 'expirado', 'cancelado');

-- =============================================================================
-- 1. Pacotes
-- =============================================================================
create table public.pacotes_vendidos (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references public.clientes (id),
  servico_id uuid not null references public.servicos (id),
  total_sessoes int not null check (total_sessoes between 1 and 50),
  sessoes_usadas int not null default 0,
  valor_total_centavos int not null check (valor_total_centavos > 0),
  -- Vale até o fim deste dia (São Paulo); null = sem validade.
  validade date,
  status public.status_pacote not null default 'ativo',
  vendido_por uuid references public.colaboradores (id)
    default public.colaborador_atual_id(),
  vendido_em timestamptz not null default now(),
  cancelado_por uuid references public.colaboradores (id),
  cancelado_em timestamptz,
  atualizado_em timestamptz not null default now(),
  constraint pacotes_vendidos_sessoes_check
    check (sessoes_usadas between 0 and total_sessoes),
  constraint pacotes_vendidos_cancelamento_check
    check ((cancelado_em is null) = (cancelado_por is null))
);
create index pacotes_vendidos_cliente_idx on public.pacotes_vendidos (cliente_id);
create index pacotes_vendidos_servico_idx on public.pacotes_vendidos (servico_id);
create index pacotes_vendidos_vendido_por_idx on public.pacotes_vendidos (vendido_por);
create index pacotes_vendidos_cancelado_por_idx on public.pacotes_vendidos (cancelado_por)
  where cancelado_por is not null;
-- expirar_pacotes
create index pacotes_vendidos_validade_ativos_idx on public.pacotes_vendidos (validade)
  where status = 'ativo' and validade is not null;

create trigger pacotes_vendidos_atualizado_em before update on public.pacotes_vendidos
  for each row execute function public.set_atualizado_em();

alter table public.agendamentos
  add constraint agendamentos_pacote_vendido_id_fkey
  foreign key (pacote_vendido_id) references public.pacotes_vendidos (id);
create index agendamentos_pacote_vendido_idx on public.agendamentos (pacote_vendido_id)
  where pacote_vendido_id is not null;

-- =============================================================================
-- 2. Cobranças
-- =============================================================================
create table public.cobrancas (
  id uuid primary key default gen_random_uuid(),
  origem public.origem_pagamento not null,
  agendamento_id uuid references public.agendamentos (id),
  pacote_vendido_id uuid references public.pacotes_vendidos (id),
  cliente_id uuid not null references public.clientes (id),
  valor_bruto_centavos int not null check (valor_bruto_centavos > 0),
  desconto_centavos int not null default 0 check (desconto_centavos >= 0),
  caixa_id uuid not null references public.caixas (id),
  lancada_por uuid not null references public.colaboradores (id),
  lancada_em timestamptz not null default now(),
  constraint cobrancas_desconto_check check (desconto_centavos <= valor_bruto_centavos),
  constraint cobrancas_agendamento_unico unique (agendamento_id),
  constraint cobrancas_pacote_unico unique (pacote_vendido_id),
  constraint cobrancas_origem_agendamento_check
    check ((origem = 'agendamento') = (agendamento_id is not null)),
  constraint cobrancas_origem_pacote_check
    check ((origem = 'pacote') = (pacote_vendido_id is not null))
);
create index cobrancas_caixa_idx on public.cobrancas (caixa_id);
create index cobrancas_cliente_idx on public.cobrancas (cliente_id);
create index cobrancas_lancada_por_idx on public.cobrancas (lancada_por);

-- Pagamentos da Fase 1 → uma cobrança cada, com o mesmo id e os mesmos
-- valores (a linha de pagamento continua com valor/desconto originais).
alter table public.pagamentos add column cobranca_id uuid references public.cobrancas (id);

insert into public.cobrancas (
  id, origem, agendamento_id, pacote_vendido_id, cliente_id,
  valor_bruto_centavos, desconto_centavos, caixa_id, lancada_por, lancada_em
)
select p.id, p.origem, p.agendamento_id, null, p.cliente_id,
       p.valor_centavos, p.desconto_centavos, p.caixa_id, p.lancado_por, p.criado_em
from public.pagamentos p;

-- Migração de dados: não mexe em atualizado_em dos pagamentos antigos.
alter table public.pagamentos disable trigger pagamentos_atualizado_em;
update public.pagamentos set cobranca_id = id;
alter table public.pagamentos enable trigger pagamentos_atualizado_em;

alter table public.pagamentos alter column cobranca_id set not null;
create index pagamentos_cobranca_idx on public.pagamentos (cobranca_id);

-- A unicidade agora é da cobrança (várias partes por atendimento).
drop index public.pagamentos_agendamento_unico;
create index pagamentos_agendamento_idx on public.pagamentos (agendamento_id)
  where agendamento_id is not null;

-- =============================================================================
-- 3. Consumo de sessões (gatilhos em agendamentos)
--
-- Nomes em ordem alfabética depois de agendamentos_guarda_profissional: a
-- guarda da profissional roda antes; _sessao roda antes de _valida.
-- =============================================================================

-- Entrando em 'atendido' com pacote: trava o pacote e consome uma sessão
-- (concluído ao atingir o total). Saindo de 'atendido': devolve a sessão.
create function public.agendamentos_pacote_sessao()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_pacote public.pacotes_vendidos;
begin
  if new.status = 'atendido' and new.pacote_vendido_id is not null
     and (tg_op = 'INSERT' or old.status is distinct from 'atendido') then
    select * into v_pacote
    from public.pacotes_vendidos p
    where p.id = new.pacote_vendido_id
    for update;
    if not found then
      return new; -- a FK recusa
    end if;
    if v_pacote.status = 'cancelado' then
      raise exception 'Este pacote não está ativo.' using errcode = 'P0001';
    end if;
    if v_pacote.sessoes_usadas >= v_pacote.total_sessoes then
      raise exception 'Todas as sessões do pacote já foram usadas.' using errcode = 'P0001';
    end if;
    if v_pacote.validade < v_hoje then
      raise exception '%', 'Este pacote venceu em '
        || to_char(v_pacote.validade, 'DD/MM/YYYY') || '.'
        using errcode = 'P0001';
    end if;
    if v_pacote.status <> 'ativo' then
      raise exception 'Este pacote não está ativo.' using errcode = 'P0001';
    end if;
    update public.pacotes_vendidos
    set sessoes_usadas = sessoes_usadas + 1,
        status = case
          when sessoes_usadas + 1 >= total_sessoes then 'concluido'::public.status_pacote
          else status
        end
    where id = v_pacote.id;
  elsif tg_op = 'UPDATE' and old.status = 'atendido'
        and new.status is distinct from 'atendido'
        and old.pacote_vendido_id is not null then
    perform 1 from public.pacotes_vendidos p
    where p.id = old.pacote_vendido_id
    for update;
    update public.pacotes_vendidos
    set sessoes_usadas = sessoes_usadas - 1,
        status = case
          when status = 'concluido' and validade < v_hoje then 'expirado'::public.status_pacote
          when status = 'concluido' then 'ativo'::public.status_pacote
          else status
        end
    where id = old.pacote_vendido_id;
  end if;
  return new;
end;
$$;

-- Pacote do agendamento: da mesma cliente e do mesmo serviço; ao vincular,
-- ativo; não muda depois do atendimento concluído.
create function public.agendamentos_pacote_valida()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pacote public.pacotes_vendidos;
begin
  if tg_op = 'UPDATE' and old.status = 'atendido'
     and new.pacote_vendido_id is distinct from old.pacote_vendido_id then
    raise exception 'Não é possível trocar o pacote de um atendimento concluído.'
      using errcode = 'P0001';
  end if;
  if new.pacote_vendido_id is null then
    return new;
  end if;

  select * into v_pacote from public.pacotes_vendidos p where p.id = new.pacote_vendido_id;
  if not found then
    return new; -- a FK recusa
  end if;
  if v_pacote.cliente_id <> new.cliente_id or v_pacote.servico_id <> new.servico_id then
    raise exception 'O pacote não é desta cliente ou deste serviço.' using errcode = 'P0001';
  end if;
  -- Vínculo novo: o pacote precisa estar ativo. Se o agendamento já entra
  -- como atendido, agendamentos_pacote_sessao validou e consumiu a sessão
  -- (o pacote pode ter acabado de ficar concluído).
  if (tg_op = 'INSERT' or new.pacote_vendido_id is distinct from old.pacote_vendido_id)
     and new.status is distinct from 'atendido'
     and v_pacote.status <> 'ativo' then
    raise exception 'Este pacote não está ativo.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger agendamentos_pacote_sessao
  before insert or update of status on public.agendamentos
  for each row execute function public.agendamentos_pacote_sessao();
create trigger agendamentos_pacote_valida
  before insert or update of pacote_vendido_id, cliente_id, servico_id on public.agendamentos
  for each row execute function public.agendamentos_pacote_valida();

-- =============================================================================
-- 4. Ciclo de vida do pacote
-- =============================================================================

-- ativo → expirado quando a validade passou e ainda há sessões. Qualquer
-- colaborador ativo pode rodar (ex.: ao abrir a ficha). Devolve quantos mudaram.
create function public.expirar_pacotes()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n int;
begin
  if public.perfil_atual() is null then
    raise exception 'Acesso não autorizado' using errcode = 'P0001';
  end if;
  update public.pacotes_vendidos
  set status = 'expirado'
  where status = 'ativo'
    and validade < (now() at time zone 'America/Sao_Paulo')::date
    and sessoes_usadas < total_sessoes;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

create function public.cancelar_pacote(p_pacote uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status public.status_pacote;
begin
  if public.perfil_atual() is distinct from 'dona' then
    raise exception 'Apenas a dona pode cancelar pacotes' using errcode = 'P0001';
  end if;
  select p.status into v_status
  from public.pacotes_vendidos p
  where p.id = p_pacote
  for update;
  if not found then
    raise exception 'Pacote não encontrado' using errcode = 'P0001';
  end if;
  if v_status <> 'ativo' then
    raise exception 'Só pacotes ativos podem ser cancelados.' using errcode = 'P0001';
  end if;
  update public.pacotes_vendidos
  set status = 'cancelado',
      cancelado_por = public.colaborador_atual_id(),
      cancelado_em = now()
  where id = p_pacote;
end;
$$;

-- =============================================================================
-- 5. Cobrança
-- =============================================================================

-- Regras de parcelas de uma parte (mensagens de 0005). p_valor é o valor
-- líquido da parte; nas partes 'a_receber' as parcelas somam p_valor.
-- Interna: só as funções abaixo chamam.
create function public.validar_parte_pagamento(
  p_forma public.forma_pagamento,
  p_valor int,
  p_parcelas int,
  p_vencimentos date[],
  p_valores_parcelas int[]
)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_forma is null then
    raise exception 'Informe a forma de pagamento' using errcode = 'P0001';
  end if;
  if p_parcelas is null or p_parcelas < 1 then
    raise exception 'O número de parcelas deve ser pelo menos 1' using errcode = 'P0001';
  end if;
  if p_parcelas > 1 and p_forma not in ('credito_parcelado', 'a_receber') then
    raise exception 'Só crédito parcelado ou a receber podem ter mais de uma parcela'
      using errcode = 'P0001';
  end if;
  if p_forma = 'a_receber' then
    if p_vencimentos is null or p_valores_parcelas is null
       or cardinality(p_vencimentos) <> p_parcelas
       or cardinality(p_valores_parcelas) <> p_parcelas then
      raise exception 'Informe um vencimento e um valor para cada parcela'
        using errcode = 'P0001';
    end if;
    if array_position(p_vencimentos, null) is not null
       or array_position(p_valores_parcelas, null) is not null then
      raise exception 'Informe um vencimento e um valor para cada parcela'
        using errcode = 'P0001';
    end if;
    if exists (select 1 from unnest(p_valores_parcelas) as v (valor) where v.valor <= 0) then
      raise exception 'Cada parcela deve ter valor maior que zero' using errcode = 'P0001';
    end if;
    if (select sum(v.valor) from unnest(p_valores_parcelas) as v (valor)) <> p_valor then
      raise exception 'A soma das parcelas deve ser igual ao valor com desconto'
        using errcode = 'P0001';
    end if;
  end if;
end;
$$;

-- Cobrança de um atendimento concluído (bruto = valor previsto) ou de um
-- pacote ativo (bruto = valor do pacote), paga com 1 a 4 partes:
--   p_partes = [{ forma, valor_centavos, parcelas, vencimentos?, valores_parcelas? }]
-- Soma das partes = bruto − desconto. Uma linha de pagamentos por parte
-- (desconto 0) e as contas a receber das partes 'a_receber'. A segunda
-- cobrança do mesmo atendimento/pacote falha com 23505
-- (cobrancas_agendamento_unico / cobrancas_pacote_unico).
create function public.registrar_cobranca(
  p_origem public.origem_pagamento,
  p_agendamento uuid,
  p_pacote uuid,
  p_desconto_centavos int,
  p_partes jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_desconto int := coalesce(p_desconto_centavos, 0);
  v_caixa uuid;
  v_cliente uuid;
  v_bruto int;
  v_status_agendamento public.status_agendamento;
  v_pacote_agendamento uuid;
  v_status_pacote public.status_pacote;
  v_parte jsonb;
  v_formas public.forma_pagamento[] := '{}';
  v_valores int[] := '{}';
  v_parcelas int[] := '{}';
  v_vencimentos date[];
  v_valores_parcelas int[];
  v_soma bigint := 0;
  v_i int;
  v_id uuid;
  v_pagamento uuid;
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

  if p_origem = 'agendamento' then
    -- FOR SHARE: o status não muda enquanto a cobrança é lançada.
    select a.cliente_id, a.status, a.pacote_vendido_id, a.valor_previsto_centavos
    into v_cliente, v_status_agendamento, v_pacote_agendamento, v_bruto
    from public.agendamentos a
    where a.id = p_agendamento
    for share;
    if not found then
      raise exception 'Agendamento não encontrado' using errcode = 'P0001';
    end if;
    if v_status_agendamento is distinct from 'atendido' then
      raise exception 'Só é possível lançar pagamento de atendimento concluído.'
        using errcode = 'P0001';
    end if;
    if v_pacote_agendamento is not null then
      raise exception 'Sessão de pacote: já paga na venda do pacote.' using errcode = 'P0001';
    end if;
  elsif p_origem = 'pacote' then
    select p.cliente_id, p.status, p.valor_total_centavos
    into v_cliente, v_status_pacote, v_bruto
    from public.pacotes_vendidos p
    where p.id = p_pacote
    for share;
    if not found then
      raise exception 'Pacote não encontrado' using errcode = 'P0001';
    end if;
    if v_status_pacote <> 'ativo' then
      raise exception 'Este pacote não está ativo.' using errcode = 'P0001';
    end if;
  else
    raise exception 'Origem de cobrança inválida' using errcode = 'P0001';
  end if;

  if v_bruto is null or v_bruto <= 0 then
    raise exception 'O valor da cobrança deve ser maior que zero' using errcode = 'P0001';
  end if;
  if v_desconto < 0 or v_desconto > v_bruto then
    raise exception 'O desconto deve estar entre zero e o valor total' using errcode = 'P0001';
  end if;

  if p_partes is null or jsonb_typeof(p_partes) <> 'array' then
    raise exception 'Informe de 1 a 4 formas de pagamento.' using errcode = 'P0001';
  end if;
  if jsonb_array_length(p_partes) not between 1 and 4 then
    raise exception 'Informe de 1 a 4 formas de pagamento.' using errcode = 'P0001';
  end if;

  -- Valida todas as partes antes de gravar.
  for v_parte in select e from jsonb_array_elements(p_partes) as x (e) loop
    begin
      if jsonb_typeof(v_parte) <> 'object' then
        raise exception using errcode = '22P02';
      end if;
      v_formas := v_formas || (v_parte ->> 'forma')::public.forma_pagamento;
      v_valores := v_valores || (v_parte ->> 'valor_centavos')::int;
      v_parcelas := v_parcelas || coalesce((v_parte ->> 'parcelas')::int, 1);
      v_vencimentos := case when jsonb_typeof(v_parte -> 'vencimentos') = 'array'
        then array(select jsonb_array_elements_text(v_parte -> 'vencimentos')::date)
      end;
      v_valores_parcelas := case when jsonb_typeof(v_parte -> 'valores_parcelas') = 'array'
        then array(select jsonb_array_elements_text(v_parte -> 'valores_parcelas')::int)
      end;
    exception
      when invalid_text_representation or numeric_value_out_of_range
           or invalid_datetime_format or datetime_field_overflow then
        raise exception 'Forma de pagamento inválida' using errcode = 'P0001';
    end;
    v_i := cardinality(v_valores);
    if v_valores[v_i] is null or v_valores[v_i] <= 0 then
      raise exception 'Cada forma de pagamento deve ter valor maior que zero.'
        using errcode = 'P0001';
    end if;
    perform public.validar_parte_pagamento(
      v_formas[v_i], v_valores[v_i], v_parcelas[v_i], v_vencimentos, v_valores_parcelas
    );
    v_soma := v_soma + v_valores[v_i];
  end loop;

  if v_soma <> v_bruto - v_desconto then
    raise exception 'A soma das formas de pagamento deve ser igual ao total com desconto.'
      using errcode = 'P0001';
  end if;

  insert into public.cobrancas (
    origem, agendamento_id, pacote_vendido_id, cliente_id,
    valor_bruto_centavos, desconto_centavos, caixa_id, lancada_por
  )
  values (
    p_origem,
    case when p_origem = 'agendamento' then p_agendamento end,
    case when p_origem = 'pacote' then p_pacote end,
    v_cliente, v_bruto, v_desconto, v_caixa, public.colaborador_atual_id()
  )
  returning id into v_id;

  for v_i in 1 .. cardinality(v_formas) loop
    insert into public.pagamentos (
      caixa_id, cliente_id, origem, agendamento_id, forma, parcelas,
      valor_centavos, desconto_centavos, lancado_por, cobranca_id
    )
    values (
      v_caixa, v_cliente, p_origem,
      case when p_origem = 'agendamento' then p_agendamento end,
      v_formas[v_i], v_parcelas[v_i], v_valores[v_i], 0,
      public.colaborador_atual_id(), v_id
    )
    returning id into v_pagamento;

    if v_formas[v_i] = 'a_receber' then
      v_parte := p_partes -> (v_i - 1);
      insert into public.contas_receber (
        cliente_id, pagamento_id, numero, total_parcelas, valor_centavos, vencimento
      )
      select v_cliente, v_pagamento, u.numero::int, v_parcelas[v_i], u.valor::int, u.vencimento::date
      from unnest(
        array(select jsonb_array_elements_text(v_parte -> 'vencimentos')),
        array(select jsonb_array_elements_text(v_parte -> 'valores_parcelas'))
      ) with ordinality as u (vencimento, valor, numero);
    end if;
  end loop;

  return v_id;
end;
$$;

-- Vende um pacote e lança a cobrança dele na mesma transação (erro em
-- qualquer parte desfaz a venda). Devolve o id do pacote.
create function public.vender_pacote(
  p_cliente uuid,
  p_servico uuid,
  p_total_sessoes int,
  p_valor_total_centavos int,
  p_validade date,
  p_desconto_centavos int,
  p_partes jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if public.perfil_atual() is distinct from 'dona'
     and public.perfil_atual() is distinct from 'recepcao' then
    raise exception 'Apenas a dona ou a recepção podem vender pacotes'
      using errcode = 'P0001';
  end if;
  if p_total_sessoes is null or p_total_sessoes not between 1 and 50 then
    raise exception 'O pacote deve ter de 1 a 50 sessões.' using errcode = 'P0001';
  end if;
  if p_valor_total_centavos is null or p_valor_total_centavos <= 0 then
    raise exception 'O valor do pacote deve ser maior que zero' using errcode = 'P0001';
  end if;
  if p_validade < (now() at time zone 'America/Sao_Paulo')::date then
    raise exception 'A validade não pode ser anterior a hoje.' using errcode = 'P0001';
  end if;
  if p_cliente is null
     or not exists (select 1 from public.clientes cl where cl.id = p_cliente) then
    raise exception 'Cliente não encontrada' using errcode = 'P0001';
  end if;
  if not exists (
    select 1 from public.servicos s where s.id = p_servico and s.ativo
  ) then
    raise exception 'Serviço não encontrado ou inativo' using errcode = 'P0001';
  end if;

  insert into public.pacotes_vendidos (
    cliente_id, servico_id, total_sessoes, valor_total_centavos, validade
  )
  values (p_cliente, p_servico, p_total_sessoes, p_valor_total_centavos, p_validade)
  returning id into v_id;

  perform public.registrar_cobranca(
    'pacote', null, v_id, p_desconto_centavos, p_partes
  );
  return v_id;
end;
$$;

-- Atalho de uma parte (Fase 1): mesma assinatura e retorno (id do
-- pagamento). Aceita venda de produto (sem agendamento) e cortesia
-- (desconto = valor). Cria antes a cobrança (bruto = valor, desconto) e grava
-- a linha de pagamento com valor/desconto originais, como em 0005.
create or replace function public.registrar_pagamento(
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
  v_origem public.origem_pagamento;
  v_caixa uuid;
  v_cliente_agendamento uuid;
  v_status_agendamento public.status_agendamento;
  v_pacote_agendamento uuid;
  v_cobranca uuid;
  v_id uuid;
begin
  if public.perfil_atual() is distinct from 'dona'
     and public.perfil_atual() is distinct from 'recepcao' then
    raise exception 'Apenas a dona ou a recepção podem lançar pagamentos'
      using errcode = 'P0001';
  end if;

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
    select a.cliente_id, a.status, a.pacote_vendido_id
    into v_cliente_agendamento, v_status_agendamento, v_pacote_agendamento
    from public.agendamentos a
    where a.id = p_agendamento
    for share;
    if not found then
      raise exception 'Agendamento não encontrado' using errcode = 'P0001';
    end if;
    if v_cliente_agendamento <> p_cliente then
      raise exception 'O agendamento é de outra cliente' using errcode = 'P0001';
    end if;
    if v_status_agendamento is distinct from 'atendido' then
      raise exception 'Só é possível lançar pagamento de atendimento concluído.'
        using errcode = 'P0001';
    end if;
    if v_pacote_agendamento is not null then
      raise exception 'Sessão de pacote: já paga na venda do pacote.' using errcode = 'P0001';
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
  perform public.validar_parte_pagamento(
    p_forma, p_valor_centavos - v_desconto, v_parcelas, p_vencimentos, p_valores_parcelas
  );

  v_origem := case when p_agendamento is not null
    then 'agendamento'::public.origem_pagamento
    else 'venda_produto'::public.origem_pagamento
  end;

  insert into public.cobrancas (
    origem, agendamento_id, cliente_id, valor_bruto_centavos, desconto_centavos,
    caixa_id, lancada_por
  )
  values (
    v_origem, p_agendamento, p_cliente, p_valor_centavos, v_desconto,
    v_caixa, public.colaborador_atual_id()
  )
  returning id into v_cobranca;

  insert into public.pagamentos (
    caixa_id, cliente_id, origem, agendamento_id, forma, parcelas,
    valor_centavos, desconto_centavos, lancado_por, cobranca_id
  )
  values (
    v_caixa, p_cliente, v_origem, p_agendamento, p_forma, v_parcelas,
    p_valor_centavos, v_desconto, public.colaborador_atual_id(), v_cobranca
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

-- =============================================================================
-- 6. Listas de "sem pagamento": agora pela cobrança (mesmas assinaturas)
-- =============================================================================
create or replace function public.agendamentos_sem_pagamento(p_data date)
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
      select 1 from public.cobrancas c where c.agendamento_id = a.id
    )
  order by a.inicio
$$;

create or replace function public.agendamentos_sem_pagamento_periodo(p_de date, p_ate date)
returns setof uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_de is null or p_ate is null or p_ate < p_de or p_ate - p_de > 61 then
    raise exception 'Período inválido' using errcode = 'P0001';
  end if;
  if public.perfil_atual() is null
     or public.perfil_atual() not in ('dona', 'recepcao') then
    return;
  end if;
  return query
    select a.id
    from public.agendamentos a
    where a.status = 'atendido'
      and a.pacote_vendido_id is null
      and a.inicio >= (p_de::timestamp at time zone 'America/Sao_Paulo')
      and a.inicio < ((p_ate + 1)::timestamp at time zone 'America/Sao_Paulo')
      and not exists (
        select 1 from public.cobrancas c where c.agendamento_id = a.id
      )
    order by a.inicio;
end;
$$;

-- =============================================================================
-- 7. Privilégios das funções
-- =============================================================================
revoke execute on function public.agendamentos_pacote_sessao() from public, anon, authenticated;
revoke execute on function public.agendamentos_pacote_valida() from public, anon, authenticated;
revoke execute on function public.validar_parte_pagamento(
  public.forma_pagamento, int, int, date[], int[]
) from public, anon, authenticated;
revoke execute on function public.expirar_pacotes() from public, anon;
revoke execute on function public.cancelar_pacote(uuid) from public, anon;
revoke execute on function public.registrar_cobranca(
  public.origem_pagamento, uuid, uuid, int, jsonb
) from public, anon;
revoke execute on function public.vender_pacote(
  uuid, uuid, int, int, date, int, jsonb
) from public, anon;
grant execute on function public.expirar_pacotes() to authenticated;
grant execute on function public.cancelar_pacote(uuid) to authenticated;
grant execute on function public.registrar_cobranca(
  public.origem_pagamento, uuid, uuid, int, jsonb
) to authenticated;
grant execute on function public.vender_pacote(
  uuid, uuid, int, int, date, int, jsonb
) to authenticated;

-- =============================================================================
-- 8. RLS e privilégios das tabelas
-- =============================================================================
alter table public.pacotes_vendidos enable row level security;
alter table public.cobrancas enable row level security;

-- Escrita só pelas funções acima; ninguém apaga (42501).
revoke all on table public.pacotes_vendidos, public.cobrancas from anon;
revoke insert, update, delete, truncate on table public.pacotes_vendidos, public.cobrancas
  from authenticated;

-- pacotes: mesma regra da ficha (dona e recepção; profissional vinculada).
create policy pacotes_vendidos_select on public.pacotes_vendidos
  for select to authenticated
  using (public.acesso_clinico(cliente_id, 'pacotes'));

-- cobrancas: dona todas; recepção só as do caixa de hoje aberto.
create policy cobrancas_select on public.cobrancas
  for select to authenticated
  using (
    (select public.perfil_atual()) = 'dona'
    or (
      (select public.perfil_atual()) = 'recepcao'
      and caixa_id = (select public.caixa_aberto_hoje_id())
    )
  );
