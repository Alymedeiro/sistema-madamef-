-- =============================================================================
-- 0023_agrupar_confirmacoes — uma confirmação (e um lembrete) por cliente por dia.
--
-- Antes: cada agendamento gerava a própria confirmação e o próprio lembrete;
-- cliente com 3 serviços no mesmo dia recebia 3 mensagens, e o "1" só
-- confirmava o primeiro horário.
--
--   1. fila_mensagens.agendamentos_grupo: agendamentos que a mensagem enviada
--      cobriu.
--   2. grupo_mensagem_agenda(p_id): para uma confirmação/lembrete, os
--      agendamentos futuros da mesma cliente no mesmo dia (São Paulo) e no
--      status que a mensagem pede (confirmação → pendente; lembrete →
--      confirmado), em ordem de horário, e se o agendamento desta mensagem já
--      foi coberto por outra mensagem enviada do mesmo tipo.
--   3. registrar_grupo_envio(p_id, p_agendamentos): depois do envio, grava o
--      grupo e cancela as outras mensagens pendentes do mesmo tipo desses
--      agendamentos ("Enviada junto com outra mensagem do mesmo dia").
--   4. registrar_recebida (corpo de 0017): "1"/"sim" confirma TODOS os
--      horários pendentes da cliente naquele dia.
-- O app (rota do relógio) monta o texto com os serviços do grupo.
-- =============================================================================
set lock_timeout = '5s';

alter table public.fila_mensagens add column agendamentos_grupo uuid[];

create function public.grupo_mensagem_agenda(p_id uuid)
returns table (
  agendamento_id uuid,
  inicio timestamptz,
  servico text,
  profissional text,
  ja_enviada boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  with m as (
    select f.id, f.tipo, f.agendamento_id, a.cliente_id, a.inicio
    from public.fila_mensagens f
    join public.agendamentos a on a.id = f.agendamento_id
    where f.id = p_id and f.tipo in ('confirmacao', 'lembrete')
  ),
  coberta as (
    select exists (
      select 1 from public.fila_mensagens g, m
      where g.tipo = m.tipo and g.status = 'enviada' and g.id <> m.id
        and m.agendamento_id = any (g.agendamentos_grupo)
    ) as v
  )
  select a.id, a.inicio, s.nome, c.nome, (select v from coberta)
  from m
  join public.agendamentos a on a.cliente_id = m.cliente_id
  join public.servicos s on s.id = a.servico_id
  join public.colaboradores c on c.id = a.profissional_id
  where (a.inicio at time zone 'America/Sao_Paulo')::date
          = (m.inicio at time zone 'America/Sao_Paulo')::date
    and a.inicio > now()
    and a.status = case when m.tipo = 'confirmacao'
                        then 'pendente'::public.status_agendamento
                        else 'confirmado'::public.status_agendamento end
  order by a.inicio, a.id
$$;

revoke execute on function public.grupo_mensagem_agenda(uuid) from public, anon, authenticated;
grant execute on function public.grupo_mensagem_agenda(uuid) to service_role;

create function public.registrar_grupo_envio(p_id uuid, p_agendamentos uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tipo public.tipo_mensagem;
begin
  update public.fila_mensagens f set agendamentos_grupo = p_agendamentos
  where f.id = p_id
  returning f.tipo into v_tipo;
  if v_tipo not in ('confirmacao', 'lembrete') then
    return;
  end if;
  update public.fila_mensagens f
  set status = 'cancelada', cancelada_motivo = 'Enviada junto com outra mensagem do mesmo dia'
  where f.tipo = v_tipo
    and f.status = 'pendente'
    and f.id <> p_id
    and f.agendamento_id = any (p_agendamentos);
end;
$$;

revoke execute on function public.registrar_grupo_envio(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.registrar_grupo_envio(uuid, uuid[]) to service_role;

create or replace function public.registrar_recebida(p_telefone text, p_texto text, p_id_externo text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_telefone text := regexp_replace(coalesce(p_telefone, ''), '\D', '', 'g');
  v_alternativo text;
  v_texto text := left(coalesce(p_texto, ''), 4096);
  v_classificacao text := public.classificar_resposta(p_texto);
  v_agendamento uuid;
  v_status public.status_agendamento;
  v_cliente uuid;
  v_ultimo_tipo public.tipo_mensagem;
  v_ultimo_texto text;
  v_ultimo_em timestamptz;
  v_id uuid;
begin
  if p_id_externo is null or btrim(p_id_externo) = '' then
    raise exception 'Mensagem sem identificador.' using errcode = 'P0001';
  end if;

  select r.id into v_id from public.mensagens_recebidas r where r.id_externo = p_id_externo;
  if found then
    return v_id;
  end if;

  if v_telefone = '' then
    v_telefone := left(coalesce(nullif(btrim(p_telefone), ''), '?'), 40);
  elsif v_telefone ~ '^55\d{10}$' then
    -- 55DD + 8 dígitos → também com o 9 depois do DDD.
    v_alternativo := left(v_telefone, 4) || '9' || substr(v_telefone, 5);
  elsif v_telefone ~ '^55\d{2}9\d{8}$' then
    -- 55DD + 9 + 8 dígitos → também sem o 9.
    v_alternativo := left(v_telefone, 4) || substr(v_telefone, 6);
  end if;

  select a.id, a.status, a.cliente_id into v_agendamento, v_status, v_cliente
  from public.agendamentos a
  join public.clientes c on c.id = a.cliente_id
  where c.whatsapp in (v_telefone, v_alternativo)
    and a.status <> 'cancelado'
    and a.inicio >= now() - interval '2 hours'
  order by a.inicio, a.id
  limit 1
  for update of a;

  if v_cliente is null then
    select c.id into v_cliente
    from public.clientes c
    where c.whatsapp in (v_telefone, v_alternativo)
    order by c.ativo desc, (c.whatsapp = v_telefone) desc, c.criado_em desc
    limit 1;
  end if;

  -- Robô (0017): o dígito responde ao que saiu por último para o telefone.
  -- Com o robô atendendo agora (ativo, WhatsApp ligado, dentro do 'quando') e
  -- a sessão sem pausa, se a mensagem enviada mais recente entre
  -- {confirmação, robô} é menu ou resposta de opção do robô (nas últimas
  -- 2 h), o dígito é opção do menu: 'para_ler', sem tocar no agendamento
  -- (robo_processar responde a opção). Só dígitos: "sim", "confirmo" e
  -- "confirmar" sempre confirmam. Nos outros casos vale a classificação de
  -- sempre.
  if v_classificacao in ('confirmou', 'quer_remarcar') and v_agendamento is not null
     and btrim(v_texto) ~ '^[1-8]\.?$'
     and public.robo_atende_agora() then
    select f.tipo, f.texto, f.enviada_em into v_ultimo_tipo, v_ultimo_texto, v_ultimo_em
    from public.fila_mensagens f
    where f.telefone in (v_telefone, v_alternativo)
      and f.status = 'enviada'
      and f.tipo in ('confirmacao', 'robo')
    order by f.enviada_em desc, f.id
    limit 1;
    if v_ultimo_tipo = 'robo'
       and v_ultimo_em > now() - interval '2 hours'
       -- Menu ou resposta de opção; a de "falar com a equipe" não abre menu.
       and v_ultimo_texto is distinct from public.robo_texto_equipe()
       and not exists (
         select 1 from public.robo_sessoes rs
         where rs.telefone in (v_telefone, v_alternativo)
           and rs.pausado_ate > now()
       ) then
      v_classificacao := 'para_ler';
    end if;
  end if;

  if v_agendamento is null and v_classificacao in ('confirmou', 'quer_remarcar') then
    v_classificacao := 'para_ler';
  end if;

  insert into public.mensagens_recebidas (
    telefone, texto, id_externo, cliente_id, agendamento_id, classificacao
  ) values (
    v_telefone, v_texto, p_id_externo, v_cliente, v_agendamento, v_classificacao
  )
  on conflict (id_externo) do nothing
  returning id into v_id;

  if v_id is null then
    -- Corrida com a mesma resposta: a outra gravou primeiro.
    select r.id into v_id from public.mensagens_recebidas r where r.id_externo = p_id_externo;
    return v_id;
  end if;

  -- 0023: confirma todos os horários pendentes da cliente naquele dia (a
  -- confirmação sai uma vez só por dia, com todos os serviços).
  if v_classificacao = 'confirmou' and v_status = 'pendente' then
    update public.agendamentos a set status = 'confirmado'
    where a.status = 'pendente'
      and a.cliente_id = v_cliente
      and a.inicio >= now() - interval '2 hours'
      and (a.inicio at time zone 'America/Sao_Paulo')::date = (
        select (x.inicio at time zone 'America/Sao_Paulo')::date
        from public.agendamentos x where x.id = v_agendamento
      );
  end if;

  -- Robô (0017): nunca falha o registro.
  begin
    perform public.robo_processar(v_id);
  exception when others then
    raise warning 'Robô: não foi possível processar a resposta %: %', v_id, sqlerrm;
  end;

  return v_id;
end;
$$;


revoke execute on function public.registrar_recebida(text, text, text)
  from public, anon, authenticated;
grant execute on function public.registrar_recebida(text, text, text) to service_role;
