-- =============================================================================
-- 0012_whatsapp — Fase 3B: WhatsApp automático (Z-API)
--
--   1. Liga/desliga (configuracoes_clinica.whatsapp_ativo), modelos de
--      mensagem (1–5 variações por tipo, textos padrão) e a fila de mensagens,
--      com RLS (modelos: autenticados leem, só a dona altera; fila: dona e
--      recepção leem; escrita da fila só por gatilhos e funções; nada é
--      apagado).
--   2. Agendamento automático: gatilho em agendamentos (confirmação,
--      lembrete, pós-atendimento; cancelar/remarcar cancela as pendentes),
--      gatilho em pedidos_online (pedido aprovado/recusado), envio avulso,
--      cancelar e reenviar (dona e recepção) e enfileirar_aniversarios (job
--      diário).
--
-- A fila nunca faz falhar o comando de agenda ou de pedido: qualquer erro ao
-- enfileirar vira um WARNING e o comando segue.
--
-- Horários: confirmação em inicio − 24h (ou agora, se já passou; não cria se
-- o atendimento já começou); lembrete em inicio − 2h (não cria se já passou);
-- pós-atendimento às 10:00 (São Paulo) do dia seguinte ao início; aniversário
-- às 09:00 (São Paulo) do dia (ou agora, se já passou).
--
-- Dependências: 0001_base (configuracoes_clinica, clientes, colaboradores,
-- perfil_atual, colaborador_atual_id, set_atualizado_em), 0002_agenda
-- (agendamentos, status_agendamento), 0009_agendamento_online
-- (pedidos_online).
-- =============================================================================

-- =============================================================================
-- 1. Configuração, modelos e fila
-- =============================================================================

alter table public.configuracoes_clinica
  add column whatsapp_ativo boolean not null default false;

create type public.tipo_mensagem as enum (
  'confirmacao', 'lembrete', 'pos_atendimento', 'aniversario',
  'pedido_aprovado', 'pedido_recusado', 'avulsa'
);
create type public.status_mensagem as enum (
  'pendente', 'enviando', 'enviada', 'falhou', 'cancelada'
);

-- 1–5 variações, sem nulos, cada uma com 1–1000 caracteres após trim.
create function public.variacoes_mensagem_validas(p_variacoes text[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_variacoes is not null
     and cardinality(p_variacoes) between 1 and 5
     and array_ndims(p_variacoes) = 1
     and not exists (
       select 1 from unnest(p_variacoes) v
       where v is null or char_length(btrim(v)) not between 1 and 1000
     )
$$;

revoke execute on function public.variacoes_mensagem_validas(text[]) from public, anon;
grant execute on function public.variacoes_mensagem_validas(text[])
  to authenticated, service_role;

-- Um modelo por tipo (avulsa não tem modelo: o texto já vem pronto).
create table public.modelos_mensagem (
  tipo public.tipo_mensagem primary key check (tipo <> 'avulsa'),
  variacoes text[] not null
    constraint modelos_mensagem_variacoes_check
    check (public.variacoes_mensagem_validas(variacoes)),
  ativo boolean not null default true,
  atualizado_em timestamptz not null default now()
);

create trigger modelos_mensagem_atualizado_em before update on public.modelos_mensagem
  for each row execute function public.set_atualizado_em();

insert into public.modelos_mensagem (tipo, variacoes) values
  ('confirmacao', array['Oi, {nome}! Passando para confirmar seu horário de {servico} com {profissional} em {data} às {hora}. Responda 1 para confirmar ou 2 para remarcar. {clinica}']),
  ('lembrete', array['Oi, {nome}! Lembrete: hoje às {hora} você tem {servico} com {profissional}. Te esperamos! {clinica}']),
  ('pos_atendimento', array['Oi, {nome}! Obrigada pela visita. Como você está se sentindo depois do {servico}? Qualquer dúvida, é só responder. {clinica}']),
  ('aniversario', array['Feliz aniversário, {nome}! 🎉 Toda a equipe da {clinica} deseja um dia lindo para você.']),
  ('pedido_aprovado', array['Oi, {nome}! Seu horário de {servico} com {profissional} está confirmado para {data} às {hora}. {clinica}']),
  ('pedido_recusado', array['Oi, {nome}! Infelizmente o horário pedido para {servico} não está disponível. Você pode escolher outro em nosso site ou responder esta mensagem. {clinica}']);

create table public.fila_mensagens (
  id uuid primary key default gen_random_uuid(),
  tipo public.tipo_mensagem not null,
  -- Nula na resposta de pedido recusado (ainda não há cliente cadastrada).
  cliente_id uuid references public.clientes (id),
  pedido_online_id uuid references public.pedidos_online (id),
  agendamento_id uuid references public.agendamentos (id),
  telefone text not null check (telefone ~ '^55\d{10,11}$'),
  -- Nulo até enviar (renderizado no envio), exceto na avulsa.
  texto text,
  agendado_para timestamptz not null,
  status public.status_mensagem not null default 'pendente',
  tentativas int not null default 0 check (tentativas >= 0),
  proxima_tentativa_em timestamptz,
  erro text,
  id_externo text,
  enviada_em timestamptz,
  cancelada_motivo text check (char_length(cancelada_motivo) between 1 and 200),
  criado_por uuid references public.colaboradores (id),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  constraint fila_mensagens_texto_check
    check (texto is not null or (tipo <> 'avulsa' and status <> 'enviada')),
  constraint fila_mensagens_cancelada_check
    check ((status = 'cancelada') = (cancelada_motivo is not null))
);

create index fila_mensagens_status_agendado_idx
  on public.fila_mensagens (status, agendado_para);
create index fila_mensagens_agendamento_idx on public.fila_mensagens (agendamento_id);
create index fila_mensagens_cliente_idx on public.fila_mensagens (cliente_id);
create index fila_mensagens_pedido_online_idx on public.fila_mensagens (pedido_online_id);
create index fila_mensagens_criado_por_idx on public.fila_mensagens (criado_por);

-- Uma confirmação / um lembrete / um pós-atendimento pendente (ou enviando)
-- por agendamento.
create unique index fila_mensagens_agenda_unica_idx
  on public.fila_mensagens (agendamento_id, tipo)
  where status in ('pendente', 'enviando')
    and tipo in ('confirmacao', 'lembrete', 'pos_atendimento');

-- Um aniversário por cliente por ano (São Paulo). Falhou e cancelada não
-- contam, para que reenviar_mensagem crie a nova; enfileirar_aniversarios
-- não recria um aniversário que falhou.
create unique index fila_mensagens_aniversario_unico_idx
  on public.fila_mensagens (
    cliente_id,
    extract(year from (agendado_para at time zone 'America/Sao_Paulo'))
  )
  where tipo = 'aniversario' and status not in ('cancelada', 'falhou');

create trigger fila_mensagens_atualizado_em before update on public.fila_mensagens
  for each row execute function public.set_atualizado_em();

-- RLS. Modelos: todos os autenticados ativos leem; só a dona altera
-- (variações e ativo); ninguém insere nem exclui. Fila: dona e recepção
-- leem; profissional e anon nada; escrita só pelos gatilhos e funções.
alter table public.modelos_mensagem enable row level security;
alter table public.fila_mensagens enable row level security;

revoke all on public.modelos_mensagem, public.fila_mensagens from anon, authenticated;
revoke delete, truncate on public.modelos_mensagem, public.fila_mensagens from service_role;
grant select on public.modelos_mensagem, public.fila_mensagens to authenticated;
grant update (variacoes, ativo) on public.modelos_mensagem to authenticated;

create policy modelos_mensagem_select on public.modelos_mensagem
  for select to authenticated
  using ((select public.perfil_atual()) is not null);
create policy modelos_mensagem_update on public.modelos_mensagem
  for update to authenticated
  using ((select public.perfil_atual()) = 'dona')
  with check ((select public.perfil_atual()) = 'dona');

create policy fila_mensagens_select on public.fila_mensagens
  for select to authenticated
  using ((select public.perfil_atual()) in ('dona', 'recepcao'));

-- =============================================================================
-- 2. Agendamento automático, avulsa, cancelar, reenviar e aniversários
-- =============================================================================

-- Cancela as pendentes de confirmação e lembrete do agendamento.
create function public.cancelar_mensagens_agenda(p_agendamento uuid, p_motivo text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.fila_mensagens
  set status = 'cancelada', cancelada_motivo = p_motivo
  where agendamento_id = p_agendamento
    and status = 'pendente'
    and tipo in ('confirmacao', 'lembrete');
$$;

revoke execute on function public.cancelar_mensagens_agenda(uuid, text)
  from public, anon, authenticated, service_role;

-- Enfileira uma mensagem de agenda se ainda não há uma pendente do mesmo tipo
-- para o agendamento (índice fila_mensagens_agenda_unica_idx).
create function public.enfileirar_mensagem_agenda(
  p_tipo public.tipo_mensagem,
  p_agendamento uuid,
  p_cliente uuid,
  p_telefone text,
  p_agendado_para timestamptz
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.fila_mensagens (
    tipo, cliente_id, agendamento_id, telefone, agendado_para, criado_por
  ) values (
    p_tipo, p_cliente, p_agendamento, p_telefone, p_agendado_para,
    public.colaborador_atual_id()
  )
  on conflict do nothing;
$$;

revoke execute on function public.enfileirar_mensagem_agenda(
  public.tipo_mensagem, uuid, uuid, text, timestamptz
) from public, anon, authenticated, service_role;

-- Gatilho da agenda:
--   * update que tira o agendamento de pendente/confirmado ou muda o início →
--     cancela confirmação/lembrete pendentes ('Agendamento cancelado' se
--     cancelado; senão 'Agendamento alterado');
--   * pendente (e o início ainda não chegou) → confirmação em inicio − 24h ou
--     agora;
--   * pendente ou confirmado com inicio − 2h no futuro → lembrete;
--   * entrando em 'atendido' → pós-atendimento às 10:00 SP do dia seguinte.
-- Só cria se a cliente tem WhatsApp. Erro na fila → WARNING, nunca falha.
create function public.agendamentos_whatsapp()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_telefone text;
begin
  begin
    if tg_op = 'UPDATE'
       and (new.status not in ('pendente', 'confirmado')
            or new.inicio is distinct from old.inicio) then
      perform public.cancelar_mensagens_agenda(
        new.id,
        case when new.status = 'cancelado' then 'Agendamento cancelado'
             else 'Agendamento alterado' end
      );
    end if;

    select c.whatsapp into v_telefone from public.clientes c where c.id = new.cliente_id;
    if v_telefone is null then
      return null;
    end if;

    if new.status = 'pendente' and new.inicio > now() then
      perform public.enfileirar_mensagem_agenda(
        'confirmacao', new.id, new.cliente_id, v_telefone,
        greatest(new.inicio - interval '24 hours', now())
      );
    end if;

    if new.status in ('pendente', 'confirmado')
       and new.inicio - interval '2 hours' > now() then
      perform public.enfileirar_mensagem_agenda(
        'lembrete', new.id, new.cliente_id, v_telefone,
        new.inicio - interval '2 hours'
      );
    end if;

    if new.status = 'atendido'
       and (tg_op = 'INSERT' or old.status is distinct from 'atendido') then
      perform public.enfileirar_mensagem_agenda(
        'pos_atendimento', new.id, new.cliente_id, v_telefone,
        (((new.inicio at time zone 'America/Sao_Paulo')::date + 1) + time '10:00')
          at time zone 'America/Sao_Paulo'
      );
    end if;
  exception when others then
    raise warning 'WhatsApp: não foi possível atualizar a fila do agendamento %: %',
      new.id, sqlerrm;
  end;
  return null;
end;
$$;

revoke execute on function public.agendamentos_whatsapp() from public, anon, authenticated;

create trigger agendamentos_whatsapp
  after insert or update of status, inicio, fim on public.agendamentos
  for each row execute function public.agendamentos_whatsapp();

-- Pedido online respondido: aprovado (quando aprovar_pedido_online liga o
-- agendamento criado) → pedido_aprovado; recusado → pedido_recusado. Agendado
-- para agora, para o WhatsApp do pedido (se válido). Nunca falha o comando.
create function public.pedidos_online_whatsapp()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tipo public.tipo_mensagem;
  v_cliente uuid;
begin
  begin
    if new.status = 'aprovado' and new.agendamento_id is not null
       and (old.status is distinct from 'aprovado' or old.agendamento_id is null) then
      v_tipo := 'pedido_aprovado';
      select a.cliente_id into v_cliente from public.agendamentos a where a.id = new.agendamento_id;
    elsif new.status = 'recusado' and old.status is distinct from 'recusado' then
      v_tipo := 'pedido_recusado';
    else
      return null;
    end if;

    if new.whatsapp is null or new.whatsapp !~ '^55\d{10,11}$' then
      return null;
    end if;

    insert into public.fila_mensagens (
      tipo, cliente_id, pedido_online_id, agendamento_id, telefone, agendado_para, criado_por
    ) values (
      v_tipo, v_cliente, new.id, new.agendamento_id, new.whatsapp, now(),
      public.colaborador_atual_id()
    );
  exception when others then
    raise warning 'WhatsApp: não foi possível enfileirar a resposta do pedido %: %',
      new.id, sqlerrm;
  end;
  return null;
end;
$$;

revoke execute on function public.pedidos_online_whatsapp() from public, anon, authenticated;

create trigger pedidos_online_whatsapp
  after update of status, agendamento_id on public.pedidos_online
  for each row execute function public.pedidos_online_whatsapp();

-- Dona ou recepção; senão P0001.
create function public.exigir_equipe_whatsapp()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if public.perfil_atual() is null or public.perfil_atual() not in ('dona', 'recepcao') then
    raise exception 'Apenas a dona ou a recepção podem enviar mensagens.' using errcode = 'P0001';
  end if;
end;
$$;

revoke execute on function public.exigir_equipe_whatsapp()
  from public, anon, authenticated, service_role;

-- Mensagem avulsa (texto pronto, agendada para agora). Devolve o id.
create function public.enviar_avulsa(p_cliente uuid, p_texto text, p_agendamento uuid default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_texto text := btrim(coalesce(p_texto, ''));
  v_telefone text;
  v_id uuid;
begin
  perform public.exigir_equipe_whatsapp();

  if v_texto = '' then
    raise exception 'Escreva a mensagem.' using errcode = 'P0001';
  end if;

  select c.whatsapp into v_telefone from public.clientes c where c.id = p_cliente;
  if v_telefone is null then
    raise exception 'Esta cliente não tem WhatsApp cadastrado.' using errcode = 'P0001';
  end if;

  if p_agendamento is not null and not exists (
    select 1 from public.agendamentos a
    where a.id = p_agendamento and a.cliente_id = p_cliente
  ) then
    raise exception 'Agendamento não encontrado.' using errcode = 'P0001';
  end if;

  insert into public.fila_mensagens (
    tipo, cliente_id, agendamento_id, telefone, texto, agendado_para, criado_por
  ) values (
    'avulsa', p_cliente, p_agendamento, v_telefone, v_texto, now(),
    public.colaborador_atual_id()
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke execute on function public.enviar_avulsa(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.enviar_avulsa(uuid, text, uuid) to authenticated;

-- Cancela uma mensagem pendente (motivo vazio → 'Cancelada pela equipe').
create function public.cancelar_mensagem(p_id uuid, p_motivo text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status public.status_mensagem;
begin
  perform public.exigir_equipe_whatsapp();

  select f.status into v_status from public.fila_mensagens f where f.id = p_id for update;
  if not found then
    raise exception 'Mensagem não encontrada.' using errcode = 'P0001';
  elsif v_status in ('enviada', 'enviando') then
    raise exception 'Esta mensagem já foi enviada.' using errcode = 'P0001';
  elsif v_status <> 'pendente' then
    raise exception 'Só é possível cancelar mensagens pendentes.' using errcode = 'P0001';
  end if;

  update public.fila_mensagens
  set status = 'cancelada',
      cancelada_motivo = left(coalesce(nullif(btrim(p_motivo), ''), 'Cancelada pela equipe'), 200)
  where id = p_id;
end;
$$;

revoke execute on function public.cancelar_mensagem(uuid, text) from public, anon, authenticated;
grant execute on function public.cancelar_mensagem(uuid, text) to authenticated;

-- Reenvia uma mensagem com falha ou cancelada: cria uma nova pendente para
-- agora (a antiga fica como está). Devolve o id da nova.
create function public.reenviar_mensagem(p_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_msg public.fila_mensagens;
  v_id uuid;
begin
  perform public.exigir_equipe_whatsapp();

  select * into v_msg from public.fila_mensagens f where f.id = p_id for update;
  if not found or v_msg.status not in ('falhou', 'cancelada') then
    raise exception 'Só é possível reenviar mensagens com falha ou canceladas.'
      using errcode = 'P0001';
  end if;

  begin
    insert into public.fila_mensagens (
      tipo, cliente_id, pedido_online_id, agendamento_id, telefone, texto,
      agendado_para, criado_por
    ) values (
      v_msg.tipo, v_msg.cliente_id, v_msg.pedido_online_id, v_msg.agendamento_id,
      v_msg.telefone,
      case when v_msg.tipo = 'avulsa' then v_msg.texto end,
      now(), public.colaborador_atual_id()
    )
    returning id into v_id;
  exception when unique_violation then
    raise exception 'Já existe uma mensagem pendente deste tipo.' using errcode = 'P0001';
  end;

  return v_id;
end;
$$;

revoke execute on function public.reenviar_mensagem(uuid) from public, anon, authenticated;
grant execute on function public.reenviar_mensagem(uuid) to authenticated;

-- Aniversariantes de p_hoje: clientes ativas, com WhatsApp e opt-in de
-- marketing; 29/02 vira 28/02 em ano não bissexto. Uma por cliente por ano
-- (um aniversário que falhou não é recriado; cancelado é). Agendado para
-- 09:00 SP de p_hoje (ou agora, se já passou). Devolve quantas enfileirou.
create function public.enfileirar_aniversarios_do_dia(p_hoje date)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ano int := extract(year from p_hoje)::int;
  v_bissexto boolean := (v_ano % 4 = 0 and v_ano % 100 <> 0) or v_ano % 400 = 0;
  v_quando timestamptz := greatest((p_hoje + time '09:00') at time zone 'America/Sao_Paulo', now());
  v_n int;
begin
  insert into public.fila_mensagens (tipo, cliente_id, telefone, agendado_para)
  select 'aniversario', c.id, c.whatsapp, v_quando
  from public.clientes c
  where c.ativo
    and c.aceita_whatsapp_marketing
    and c.whatsapp is not null
    and c.data_nascimento is not null
    and (
      (extract(month from c.data_nascimento) = extract(month from p_hoje)
       and extract(day from c.data_nascimento) = extract(day from p_hoje))
      or (not v_bissexto
          and extract(month from p_hoje) = 2 and extract(day from p_hoje) = 28
          and extract(month from c.data_nascimento) = 2
          and extract(day from c.data_nascimento) = 29)
    )
    and not exists (
      select 1 from public.fila_mensagens f
      where f.cliente_id = c.id
        and f.tipo = 'aniversario'
        and f.status <> 'cancelada'
        and extract(year from (f.agendado_para at time zone 'America/Sao_Paulo')) = v_ano
    )
  on conflict do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke execute on function public.enfileirar_aniversarios_do_dia(date)
  from public, anon, authenticated, service_role;

-- Job diário (pg_cron, 12:00 UTC = 09:00 SP): aniversariantes de hoje (SP).
create function public.enfileirar_aniversarios()
returns int
language sql
security definer
set search_path = ''
as $$
  select public.enfileirar_aniversarios_do_dia((now() at time zone 'America/Sao_Paulo')::date);
$$;

revoke execute on function public.enfileirar_aniversarios()
  from public, anon, authenticated, service_role;
