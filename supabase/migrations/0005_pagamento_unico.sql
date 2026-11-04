-- =============================================================================
-- 0005 — Ajustes da revisão final da Fase 1
--
--   1. Um pagamento por atendimento, garantido no banco: índice único parcial
--      em pagamentos(agendamento_id) para origem 'agendamento' (dois
--      lançamentos simultâneos: o segundo falha com 23505), e
--      registrar_pagamento só aceita atendimento com status 'atendido'.
--   2. agendamentos_sem_pagamento_periodo: atendidos sem pagamento num
--      período de dias (cartão do Início e agenda), só dona/recepção.
--   3. aniversariantes_entre: aniversariantes filtrados por mês/dia no banco
--      (sem o limite de linhas do PostgREST), 29/02 → 28/02 em ano comum,
--      virada de ano, com os dias até o aniversário para ordenar.
--
-- Dependências: 0001_base (clientes, perfil_atual), 0002_agenda
-- (agendamentos), 0003_caixa (pagamentos, registrar_pagamento).
-- =============================================================================

-- =============================================================================
-- 1. Pagamento único por atendimento
-- =============================================================================
create unique index pagamentos_agendamento_unico
  on public.pagamentos (agendamento_id)
  where origem = 'agendamento';

-- O índice parcial cobre as buscas por agendamento: o índice antigo sobra.
drop index public.pagamentos_agendamento_idx;

-- Mesma assinatura, grants e regras de 0003; acrescenta a exigência de
-- atendimento concluído. (create or replace preserva os privilégios.)
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
  v_caixa uuid;
  v_cliente_agendamento uuid;
  v_status_agendamento public.status_agendamento;
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
    select a.cliente_id, a.status
    into v_cliente_agendamento, v_status_agendamento
    from public.agendamentos a
    where a.id = p_agendamento;
    if not found then
      raise exception 'Agendamento não encontrado' using errcode = 'P0001';
    end if;
    if v_cliente_agendamento <> p_cliente then
      raise exception 'O agendamento é de outra cliente' using errcode = 'P0001';
    end if;
    -- Novo em 0005: só atendimento concluído é cobrado.
    if v_status_agendamento is distinct from 'atendido' then
      raise exception 'Só é possível lançar pagamento de atendimento concluído.'
        using errcode = 'P0001';
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


-- =============================================================================
-- 2. Atendidos sem pagamento num período (dias de São Paulo, inclusive)
-- =============================================================================
-- Mesmas regras de agendamentos_sem_pagamento (0003): status 'atendido', sem
-- pagamento, fora de pacote; só dona/recepção (os demais recebem vazio).
-- security definer: a recepção não enxerga pagamentos de caixas anteriores.
-- Período limitado a 62 dias para não virar uma varredura do histórico.
create function public.agendamentos_sem_pagamento_periodo(p_de date, p_ate date)
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
        select 1 from public.pagamentos p where p.agendamento_id = a.id
      )
    order by a.inicio;
end;
$$;

revoke execute on function public.agendamentos_sem_pagamento_periodo(date, date)
  from public, anon;
grant execute on function public.agendamentos_sem_pagamento_periodo(date, date)
  to authenticated;

-- =============================================================================
-- 3. Aniversariantes de um período
-- =============================================================================
-- Aniversário de quem nasceu em p_nascimento no ano p_ano; 29/02 vira 28/02
-- em ano comum.
create function public.aniversario_no_ano(p_nascimento date, p_ano int)
returns date
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case
    when extract(month from p_nascimento) = 2
         and extract(day from p_nascimento) = 29
         and not (p_ano % 4 = 0 and (p_ano % 100 <> 0 or p_ano % 400 = 0))
      then make_date(p_ano, 2, 28)
    else make_date(
      p_ano,
      extract(month from p_nascimento)::int,
      extract(day from p_nascimento)::int
    )
  end
$$;

-- Clientes ativas com aniversário entre p_de e p_ate (inclusive), com `dias`
-- = dias de p_de até o próximo aniversário. Ordem: dias, depois nome.
-- security invoker: o RLS de clientes decide quem aparece.
create function public.aniversariantes_entre(p_de date, p_ate date)
returns table (
  id uuid,
  nome text,
  data_nascimento date,
  whatsapp text,
  dias int
)
language sql
stable
security invoker
set search_path = ''
as $$
  select c.id, c.nome, c.data_nascimento, c.whatsapp, (x.proximo - p_de)::int as dias
  from public.clientes c
  cross join lateral (
    select case
      when public.aniversario_no_ano(c.data_nascimento, extract(year from p_de)::int) >= p_de
        then public.aniversario_no_ano(c.data_nascimento, extract(year from p_de)::int)
      else public.aniversario_no_ano(c.data_nascimento, extract(year from p_de)::int + 1)
    end as proximo
  ) x
  where c.ativo
    and c.data_nascimento is not null
    and x.proximo <= p_ate
  order by dias, c.nome
$$;

revoke execute on function public.aniversario_no_ano(date, int) from public, anon;
revoke execute on function public.aniversariantes_entre(date, date) from public, anon;
grant execute on function public.aniversario_no_ano(date, int) to authenticated;
grant execute on function public.aniversariantes_entre(date, date) to authenticated;
