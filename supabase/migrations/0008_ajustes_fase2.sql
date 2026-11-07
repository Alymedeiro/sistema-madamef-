-- =============================================================================
-- 0008_ajustes_fase2 — ajustes da revisão final da Fase 2
--
--   1. Cortesia: atendimento com total zero (valor previsto 0 ou desconto de
--      100%) é cobrado sem nenhuma forma de pagamento (p_partes = '[]'); a
--      cobrança fica registrada e o atendimento sai das listas "sem
--      pagamento". fechar_caixa não muda (soma só as linhas de pagamentos).
--   2. Termos e anamneses só são gravados apontando para arquivos que existem
--      no bucket `ficha-clinica` (o servidor envia antes de inserir), e cada
--      arquivo serve a um único registro. A versão da anamnese tem de ser a do
--      modelo informado.
--   3. Foto, termo e evolução ligados a um atendimento: o atendimento tem de
--      ser da mesma cliente; e a cliente de um atendimento que já tem foto,
--      termo ou evolução não pode ser trocada.
--   4. Pacote não pode ser vinculado a um atendimento que já tem cobrança.
--   5. vender_pacote idempotente: p_id opcional gerado pela tela; repetir o
--      mesmo id falha com 23505 (pacotes_vendidos_pkey) em vez de vender duas
--      vezes.
--
-- 0006 e 0007 já estão aplicadas no projeto de testes: nada delas é editado,
-- só substituído aqui (create or replace / drop + create).
--
-- Dependências: 0006_ficha_clinica (anamneses, termos_assinados, fotos,
-- evolucoes, acesso_clinico, bucket), 0007_pacotes_cobranca (cobrancas,
-- registrar_cobranca, vender_pacote, agendamentos_pacote_valida).
-- =============================================================================

-- =============================================================================
-- 1. Cortesia (cobrança de total zero)
-- =============================================================================

-- Bruto zero só em atendimento (valor previsto 0); pacote continua > 0.
alter table public.cobrancas drop constraint cobrancas_valor_bruto_centavos_check;
alter table public.cobrancas add constraint cobrancas_valor_bruto_centavos_check
  check (
    valor_bruto_centavos > 0
    or (origem = 'agendamento' and valor_bruto_centavos = 0)
  );

-- Igual à 0007, exceto: bruto 0 aceito em atendimento; p_partes = '[]' aceito
-- (e exigido, já que cada parte é > 0) quando bruto − desconto = 0.
create or replace function public.registrar_cobranca(
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
    if v_bruto is null or v_bruto < 0 then
      raise exception 'O valor da cobrança não pode ser negativo' using errcode = 'P0001';
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
    if v_bruto is null or v_bruto <= 0 then
      raise exception 'O valor da cobrança deve ser maior que zero' using errcode = 'P0001';
    end if;
  else
    raise exception 'Origem de cobrança inválida' using errcode = 'P0001';
  end if;

  if v_desconto < 0 or v_desconto > v_bruto then
    raise exception 'O desconto deve estar entre zero e o valor total' using errcode = 'P0001';
  end if;

  if p_partes is null or jsonb_typeof(p_partes) <> 'array' then
    raise exception 'Informe de 1 a 4 formas de pagamento.' using errcode = 'P0001';
  end if;
  -- Cortesia: total com desconto zero e nenhuma forma.
  if not (jsonb_array_length(p_partes) = 0 and v_bruto - v_desconto = 0)
     and jsonb_array_length(p_partes) not between 1 and 4 then
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

  -- Cortesia: cardinality = 0, nenhuma linha de pagamento.
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

-- =============================================================================
-- 2. vender_pacote idempotente (p_id opcional)
-- =============================================================================
drop function public.vender_pacote(uuid, uuid, int, int, date, int, jsonb);

-- Igual à 0007, mais p_id: id do pacote gerado pela tela (um por venda). O
-- segundo envio com o mesmo id falha com 23505 (pacotes_vendidos_pkey) e
-- nada é cobrado de novo. Sem p_id, o banco gera o id.
create function public.vender_pacote(
  p_cliente uuid,
  p_servico uuid,
  p_total_sessoes int,
  p_valor_total_centavos int,
  p_validade date,
  p_desconto_centavos int,
  p_partes jsonb,
  p_id uuid default null
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
    id, cliente_id, servico_id, total_sessoes, valor_total_centavos, validade
  )
  values (
    coalesce(p_id, gen_random_uuid()),
    p_cliente, p_servico, p_total_sessoes, p_valor_total_centavos, p_validade
  )
  returning id into v_id;

  perform public.registrar_cobranca(
    'pacote', null, v_id, p_desconto_centavos, p_partes
  );
  return v_id;
end;
$$;

revoke execute on function public.vender_pacote(
  uuid, uuid, int, int, date, int, jsonb, uuid
) from public, anon;
grant execute on function public.vender_pacote(
  uuid, uuid, int, int, date, int, jsonb, uuid
) to authenticated;

-- =============================================================================
-- 3. Termos e anamneses: arquivos existentes, únicos; versão do modelo
-- =============================================================================

-- O arquivo existe no bucket da ficha? security definer: a política de
-- insert é avaliada com o papel da usuária, que não precisa enxergar o
-- objeto (assinaturas e PDFs são gravados pelo servidor).
create function public.arquivo_ficha_existe(p_nome text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_nome is not null and exists (
    select 1
    from storage.objects o
    where o.bucket_id = 'ficha-clinica'
      and o.name = p_nome
  )
$$;

revoke execute on function public.arquivo_ficha_existe(text) from public, anon;
grant execute on function public.arquivo_ficha_existe(text) to authenticated;

alter table public.termos_assinados
  add constraint termos_assinados_pdf_path_key unique (pdf_path),
  add constraint termos_assinados_assinatura_path_key unique (assinatura_path);
alter table public.anamneses
  add constraint anamneses_assinatura_path_key unique (assinatura_path);

drop policy termos_assinados_insert on public.termos_assinados;
create policy termos_assinados_insert on public.termos_assinados
  for insert to authenticated
  with check (
    public.acesso_clinico(cliente_id, 'termos')
    and colhido_por = (select public.colaborador_atual_id())
    and public.arquivo_ficha_existe(pdf_path)
    and public.arquivo_ficha_existe(assinatura_path)
  );

drop policy anamneses_insert on public.anamneses;
create policy anamneses_insert on public.anamneses
  for insert to authenticated
  with check (
    (select public.perfil_atual()) in ('dona', 'recepcao')
    and preenchida_por = (select public.colaborador_atual_id())
    and public.arquivo_ficha_existe(assinatura_path)
  );

-- modelo_versao tem de ser a versão do modelo_id informado.
create function public.anamneses_valida_modelo()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.modelos_anamnese m
    where m.id = new.modelo_id
      and m.versao = new.modelo_versao
  ) then
    raise exception 'Versão do modelo de anamnese inválida.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger anamneses_valida_modelo
  before insert or update of modelo_id, modelo_versao on public.anamneses
  for each row execute function public.anamneses_valida_modelo();

-- =============================================================================
-- 4. Atendimento ligado a foto, termo ou evolução: da mesma cliente
-- =============================================================================

-- security definer: confere o atendimento real, mesmo que a usuária não o
-- enxergue. Atendimento inexistente fica para a FK.
create function public.ficha_atendimento_da_cliente()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cliente uuid;
begin
  if new.agendamento_id is null then
    return new;
  end if;
  select a.cliente_id into v_cliente
  from public.agendamentos a
  where a.id = new.agendamento_id;
  if found and v_cliente is distinct from new.cliente_id then
    raise exception 'O atendimento é de outra cliente.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array['fotos', 'termos_assinados', 'evolucoes']
  loop
    execute format(
      'create trigger %1$I before insert or update of agendamento_id, cliente_id on public.%2$I
         for each row execute function public.ficha_atendimento_da_cliente()',
      t || '_atendimento_da_cliente', t);
  end loop;
end
$$;

-- O outro lado: atendimento que já tem foto, termo ou evolução não muda de
-- cliente (os registros ficariam presos a um atendimento de outra pessoa).
-- security definer: confere todas as linhas, mesmo as que a usuária não vê.
create function public.agendamentos_cliente_com_ficha()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.cliente_id is distinct from old.cliente_id and (
    exists (select 1 from public.fotos f where f.agendamento_id = new.id)
    or exists (select 1 from public.termos_assinados t where t.agendamento_id = new.id)
    or exists (select 1 from public.evolucoes e where e.agendamento_id = new.id)
  ) then
    raise exception 'Este atendimento já tem fotos, termo ou evolução; não é possível trocar a cliente.'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger agendamentos_cliente_com_ficha
  before update of cliente_id on public.agendamentos
  for each row execute function public.agendamentos_cliente_com_ficha();

-- =============================================================================
-- 5. Pacote em atendimento já cobrado
-- =============================================================================

-- Igual à 0007, mais: vincular (ou trocar) pacote quando o atendimento já tem
-- cobrança é recusado (a sessão seria paga duas vezes).
create or replace function public.agendamentos_pacote_valida()
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

  if tg_op = 'UPDATE'
     and new.pacote_vendido_id is distinct from old.pacote_vendido_id
     and exists (select 1 from public.cobrancas c where c.agendamento_id = new.id) then
    raise exception 'Este atendimento já foi cobrado; não é possível usar pacote.'
      using errcode = 'P0001';
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

-- =============================================================================
-- 6. Privilégios das funções de gatilho
-- =============================================================================
revoke execute on function public.anamneses_valida_modelo() from public, anon, authenticated;
revoke execute on function public.ficha_atendimento_da_cliente() from public, anon, authenticated;
revoke execute on function public.agendamentos_cliente_com_ficha() from public, anon, authenticated;
revoke execute on function public.agendamentos_pacote_valida() from public, anon, authenticated;
