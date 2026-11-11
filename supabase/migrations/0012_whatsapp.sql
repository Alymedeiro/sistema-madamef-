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
--      cancelar e reenviar (dona e recepção), enfileirar_aniversarios (job
--      diário) e a limpeza LGPD de 0009 (apagar_dados_pedidos_antigos)
--      estendida à fila.
--   3. Envio da fila (proxima_mensagem, concluir/falhar/descartar_envio) e
--      respostas (mensagens_recebidas, registrar_recebida,
--      marcar_recebida_lida).
--   4. Relógio (whatsapp_relogio, disparar_relogio_whatsapp, jobs pg_cron
--      whatsapp_relogio, whatsapp_aniversarios e limpar_historico_cron) e
--      status da conexão (whatsapp_status, gravar_status_whatsapp).
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
--   * entrando em 'atendido' → pós-atendimento às 10:00 SP do dia seguinte
--     (não cria se esse horário ficou mais de 1 dia no passado).
-- Só cria se a cliente tem WhatsApp. Erro na fila → WARNING, nunca falha.
create function public.agendamentos_whatsapp()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_telefone text;
  v_pos timestamptz;
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

    -- Pós-atendimento atrasado há mais de 1 dia (atendido marcado tarde ou
    -- lançamento retroativo) não é enfileirado (Ruling P3B-R3).
    v_pos := (((new.inicio at time zone 'America/Sao_Paulo')::date + 1) + time '10:00')
               at time zone 'America/Sao_Paulo';
    if new.status = 'atendido'
       and (tg_op = 'INSERT' or old.status is distinct from 'atendido')
       and v_pos >= now() - interval '1 day' then
      perform public.enfileirar_mensagem_agenda(
        'pos_atendimento', new.id, new.cliente_id, v_telefone, v_pos
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
-- para agora, para o WhatsApp do pedido (se válido), só com o envio ligado.
-- Nunca falha o comando.
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

    -- Envio desligado: a equipe avisa pelo botão manual "Avisar no WhatsApp";
    -- nada fica na fila para sair (duplicado) quando o envio for ligado.
    if not coalesce((select cc.whatsapp_ativo from public.configuracoes_clinica cc limit 1), false) then
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
  elsif v_status = 'enviando' then
    raise exception 'Esta mensagem está sendo enviada.' using errcode = 'P0001';
  elsif v_status = 'enviada' then
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
  if not found then
    raise exception 'Mensagem não encontrada.' using errcode = 'P0001';
  elsif v_msg.status not in ('falhou', 'cancelada') then
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

-- LGPD: a limpeza de 90 dias de 0009 (pedidos não aprovados) também apaga o
-- telefone e o texto das respostas de pedido sem cliente cadastrada (o
-- pedido recusado). Corpo de 0009 inalterado; mesmos grants.
create or replace function public.apagar_dados_pedidos_antigos()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n int;
begin
  update public.pedidos_online
  set nome = null, whatsapp = null, dados_apagados_em = now()
  where status <> 'aprovado'
    and criado_em < now() - interval '90 days'
    and dados_apagados_em is null;
  get diagnostics v_n = row_count;

  update public.pedidos_online
  set ip_hash = null
  where criado_em < now() - interval '1 day'
    and ip_hash is not null;

  update public.fila_mensagens f
  set telefone = '550000000000',
      texto = case when f.texto is not null then '[dados apagados]' end
  where f.pedido_online_id in (
      select p.id from public.pedidos_online p
      where p.status <> 'aprovado'
        and p.criado_em < now() - interval '90 days'
    )
    and f.cliente_id is null
    and (f.telefone <> '550000000000' or f.texto <> '[dados apagados]');

  return v_n;
end;
$$;

revoke execute on function public.apagar_dados_pedidos_antigos() from public, anon, authenticated;
grant execute on function public.apagar_dados_pedidos_antigos() to service_role;

-- =============================================================================
-- 3. Envio da fila e respostas
--
-- O relógio (pg_cron → /api/whatsapp/processar, uma vez por minuto) chama
-- proxima_mensagem, renderiza e envia em TS e fecha com concluir_envio,
-- falhar_envio ou descartar_envio. As condições de envio que dependem do
-- agendamento (confirmação só se pendente, lembrete só se confirmado, pós só
-- se atendido, horário ainda no futuro) ficam no TS (podeEnviar): por isso a
-- linha devolve o status e o início atuais do agendamento.
--
-- Ritmo: nada se whatsapp_ativo = false ou fora da janela [início, fim) em
-- São Paulo; no máximo 1 envio por minuto (nenhuma em envio e nenhuma enviada
-- nos últimos 45 s — folga para o tempo do próprio envio, que grava
-- enviada_em alguns segundos depois do disparo do relógio) e enviadas na
-- última hora < whatsapp_limite_por_hora. Duas execuções simultâneas do
-- relógio são serializadas por uma trava de transação: a segunda vê a
-- mensagem em envio da primeira e não pega nada.
-- =============================================================================

-- Classificação da resposta (mesma tabela do TS): após trim e minúsculas,
-- '1', '1.', 'sim', 'confirmo', 'confirmar' → confirmou; '2', '2.' →
-- quer_remarcar; o resto → para_ler.
create function public.classificar_resposta(p_texto text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when v in ('1', '1.', 'sim', 'confirmo', 'confirmar') then 'confirmou'
    when v in ('2', '2.') then 'quer_remarcar'
    else 'para_ler'
  end
  from (select lower(regexp_replace(coalesce(p_texto, ''), '^\s+|\s+$', '', 'g')) as v) t
$$;

revoke execute on function public.classificar_resposta(text)
  from public, anon, authenticated, service_role;

-- Próxima mensagem a enviar (0 ou 1 linha), já marcada como 'enviando'.
-- Antes de escolher: mensagens em envio há mais de 10 minutos (rota caiu
-- sem concluir) viram 'falhou' — não são reenviadas sozinhas, para não
-- duplicar; a equipe pode reenviar — e as vencidas de um modelo desativado
-- viram 'cancelada' ('Modelo desativado'); pós-atendimento, aniversário e
-- respostas de pedido vencidas há mais de 24 h viram 'cancelada' ('Mensagem
-- perdeu a validade').
create function public.proxima_mensagem()
returns table (
  id uuid,
  tipo public.tipo_mensagem,
  telefone text,
  texto text,
  variacoes text[],
  nome text,
  servico text,
  profissional text,
  inicio timestamptz,
  status_agendamento public.status_agendamento,
  clinica text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cfg public.configuracoes_clinica;
  v_hora time;
  v_id uuid;
begin
  -- Serializa as execuções do relógio (a outra espera e depois vê o envio).
  perform pg_advisory_xact_lock(hashtext('whatsapp_proxima_mensagem'));

  select * into v_cfg from public.configuracoes_clinica limit 1;
  if not found or not v_cfg.whatsapp_ativo then
    return;
  end if;

  v_hora := (now() at time zone 'America/Sao_Paulo')::time;
  if v_hora < v_cfg.whatsapp_janela_inicio or v_hora >= v_cfg.whatsapp_janela_fim then
    return;
  end if;

  update public.fila_mensagens f
  set status = 'falhou', tentativas = f.tentativas + 1,
      erro = 'Envio interrompido sem confirmação.'
  where f.status = 'enviando' and f.atualizado_em < now() - interval '10 minutes';

  if exists (
    select 1 from public.fila_mensagens f
    where f.status = 'enviando'
       or (f.status = 'enviada' and f.enviada_em > now() - interval '45 seconds')
  ) then
    return;
  end if;

  if (
    select count(*) from public.fila_mensagens f
    where f.status = 'enviada' and f.enviada_em > now() - interval '1 hour'
  ) >= v_cfg.whatsapp_limite_por_hora then
    return;
  end if;

  update public.fila_mensagens f
  set status = 'cancelada', cancelada_motivo = 'Modelo desativado'
  from public.modelos_mensagem m
  where m.tipo = f.tipo
    and not m.ativo
    and f.status = 'pendente'
    and f.agendado_para <= now();

  -- Envio desligado (ou parado) por dias: pós-atendimento, aniversário e
  -- respostas de pedido com mais de 24 h de atraso não fazem mais sentido.
  update public.fila_mensagens f
  set status = 'cancelada', cancelada_motivo = 'Mensagem perdeu a validade'
  where f.status = 'pendente'
    and f.tipo in ('pos_atendimento', 'aniversario', 'pedido_aprovado', 'pedido_recusado')
    and f.agendado_para < now() - interval '24 hours';

  select f.id into v_id
  from public.fila_mensagens f
  where f.status = 'pendente'
    and f.agendado_para <= now()
    and (f.proxima_tentativa_em is null or f.proxima_tentativa_em <= now())
  order by f.agendado_para, f.criado_em, f.id
  limit 1
  for update skip locked;

  if v_id is null then
    return;
  end if;

  update public.fila_mensagens f set status = 'enviando' where f.id = v_id;

  return query
  select f.id, f.tipo, f.telefone, f.texto, m.variacoes,
         coalesce(c.nome, p.nome), s.nome, col.nome,
         coalesce(a.inicio, p.inicio), a.status, v_cfg.nome
  from public.fila_mensagens f
  left join public.modelos_mensagem m on m.tipo = f.tipo
  left join public.agendamentos a on a.id = f.agendamento_id
  left join public.pedidos_online p on p.id = f.pedido_online_id
  left join public.clientes c on c.id = f.cliente_id
  left join public.servicos s on s.id = coalesce(a.servico_id, p.servico_id)
  left join public.colaboradores col on col.id = coalesce(a.profissional_id, p.profissional_id)
  where f.id = v_id;
end;
$$;

revoke execute on function public.proxima_mensagem() from public, anon, authenticated;
grant execute on function public.proxima_mensagem() to service_role;

-- Enviada: grava o texto final (avulsa: nulo mantém o texto pronto), o id
-- externo da Z-API e enviada_em.
create function public.concluir_envio(p_id uuid, p_texto text, p_id_externo text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.fila_mensagens f
  set status = 'enviada',
      texto = coalesce(nullif(p_texto, ''), f.texto),
      id_externo = nullif(btrim(p_id_externo), ''),
      enviada_em = now(),
      proxima_tentativa_em = null,
      erro = null
  where f.id = p_id and f.status = 'enviando';
  if not found then
    raise exception 'Esta mensagem não está em envio.' using errcode = 'P0001';
  end if;
end;
$$;

revoke execute on function public.concluir_envio(uuid, text, text) from public, anon, authenticated;
grant execute on function public.concluir_envio(uuid, text, text) to service_role;

-- Falha no envio: 1ª → nova tentativa em 5 min; 2ª → em 15 min; 3ª →
-- 'falhou'. O erro é guardado.
create function public.falhar_envio(p_id uuid, p_erro text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.fila_mensagens f
  set tentativas = f.tentativas + 1,
      erro = left(coalesce(nullif(btrim(p_erro), ''), 'Erro desconhecido'), 1000),
      status = case when f.tentativas + 1 >= 3 then 'falhou' else 'pendente' end::public.status_mensagem,
      proxima_tentativa_em = case f.tentativas + 1
        when 1 then now() + interval '5 minutes'
        when 2 then now() + interval '15 minutes'
      end
  where f.id = p_id and f.status = 'enviando';
  if not found then
    raise exception 'Esta mensagem não está em envio.' using errcode = 'P0001';
  end if;
end;
$$;

revoke execute on function public.falhar_envio(uuid, text) from public, anon, authenticated;
grant execute on function public.falhar_envio(uuid, text) to service_role;

-- Condição de envio não atendida (podeEnviar): vira 'cancelada' com o motivo.
create function public.descartar_envio(p_id uuid, p_motivo text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.fila_mensagens f
  set status = 'cancelada',
      cancelada_motivo = left(coalesce(nullif(btrim(p_motivo), ''), 'Descartada no envio'), 200)
  where f.id = p_id and f.status = 'enviando';
  if not found then
    raise exception 'Esta mensagem não está em envio.' using errcode = 'P0001';
  end if;
end;
$$;

revoke execute on function public.descartar_envio(uuid, text) from public, anon, authenticated;
grant execute on function public.descartar_envio(uuid, text) to service_role;

-- Respostas recebidas pelo webhook da Z-API. cliente_id (além da spec) guarda
-- a cliente do telefone, para a tela mostrar o nome mesmo sem agendamento.
create table public.mensagens_recebidas (
  id uuid primary key default gen_random_uuid(),
  telefone text not null check (char_length(telefone) between 1 and 40),
  texto text not null check (char_length(texto) <= 4096),
  id_externo text not null unique check (char_length(id_externo) between 1 and 200),
  recebida_em timestamptz not null default now(),
  cliente_id uuid references public.clientes (id),
  agendamento_id uuid references public.agendamentos (id),
  classificacao text not null
    check (classificacao in ('confirmou', 'quer_remarcar', 'para_ler')),
  lida_em timestamptz,
  lida_por uuid references public.colaboradores (id),
  constraint mensagens_recebidas_lida_check check (lida_por is null or lida_em is not null)
);

create index mensagens_recebidas_recebida_idx on public.mensagens_recebidas (recebida_em desc);
create index mensagens_recebidas_nao_lidas_idx
  on public.mensagens_recebidas (classificacao, recebida_em desc) where lida_em is null;
create index mensagens_recebidas_cliente_idx on public.mensagens_recebidas (cliente_id);
create index mensagens_recebidas_agendamento_idx on public.mensagens_recebidas (agendamento_id);
create index mensagens_recebidas_lida_por_idx on public.mensagens_recebidas (lida_por);

-- RLS: dona e recepção leem; escrita só pelas funções. O service_role também
-- só lê a fila e as respostas (escreve por proxima_mensagem, concluir_envio,
-- falhar_envio, descartar_envio e registrar_recebida).
alter table public.mensagens_recebidas enable row level security;

revoke all on public.mensagens_recebidas from anon, authenticated;
revoke insert, update, delete, truncate on public.mensagens_recebidas from service_role;
revoke update on public.fila_mensagens from service_role;
grant select on public.mensagens_recebidas to authenticated;

create policy mensagens_recebidas_select on public.mensagens_recebidas
  for select to authenticated
  using ((select public.perfil_atual()) in ('dona', 'recepcao'));

-- Grava uma resposta (idempotente por id_externo: repetida devolve o id da
-- primeira e não faz mais nada; sem id → P0001). Associa ao próximo
-- agendamento não cancelado (início ≥ agora − 2h, menor início) de uma
-- cliente com esse WhatsApp — com ou sem o 9 depois do DDD (o WhatsApp
-- costuma mandar 55DD + 8 dígitos; clientes.whatsapp guarda 13);
-- 'confirmou' com esse agendamento pendente → confirmado. 'confirmou' ou
-- 'quer_remarcar' sem agendamento → 'para_ler' (alguém precisa ver).
create function public.registrar_recebida(p_telefone text, p_texto text, p_id_externo text)
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

  if v_classificacao = 'confirmou' and v_status = 'pendente' then
    update public.agendamentos a set status = 'confirmado'
    where a.id = v_agendamento and a.status = 'pendente';
  end if;

  return v_id;
end;
$$;

revoke execute on function public.registrar_recebida(text, text, text)
  from public, anon, authenticated;
grant execute on function public.registrar_recebida(text, text, text) to service_role;

-- Marca uma resposta como lida (dona e recepção). Já lida → nada muda.
create function public.marcar_recebida_lida(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.exigir_equipe_whatsapp();

  if not exists (select 1 from public.mensagens_recebidas r where r.id = p_id) then
    raise exception 'Mensagem não encontrada.' using errcode = 'P0001';
  end if;

  update public.mensagens_recebidas r
  set lida_em = now(), lida_por = public.colaborador_atual_id()
  where r.id = p_id and r.lida_em is null;
end;
$$;

revoke execute on function public.marcar_recebida_lida(uuid) from public, anon, authenticated;
grant execute on function public.marcar_recebida_lida(uuid) to authenticated;

-- =============================================================================
-- 4. Relógio (pg_cron + pg_net) e status da conexão
-- =============================================================================

-- Linha única com o token que o relógio manda em x-cron-token (gerado aqui;
-- ninguém digita segredo) e a URL do site (nula = o relógio não faz nada; o
-- controlador grava a URL de cada projeto ao implantar). Só o service_role lê.
create table public.whatsapp_relogio (
  linha_unica boolean primary key default true check (linha_unica),
  token text not null default encode(extensions.gen_random_bytes(32), 'hex'),
  url text check (url ~ '^https?://\S+$')
);

insert into public.whatsapp_relogio default values;

alter table public.whatsapp_relogio enable row level security;
revoke all on public.whatsapp_relogio from anon, authenticated, service_role;
grant select on public.whatsapp_relogio to service_role;

-- Estado da conexão com a Z-API (linha única), gravado pela rota do relógio.
create table public.whatsapp_status (
  linha_unica boolean primary key default true check (linha_unica),
  estado text not null default 'sem_chaves'
    check (estado in ('conectado', 'desconectado', 'sem_chaves')),
  verificado_em timestamptz
);

insert into public.whatsapp_status default values;

alter table public.whatsapp_status enable row level security;
revoke all on public.whatsapp_status from anon, authenticated, service_role;
grant select on public.whatsapp_status to authenticated, service_role;

create policy whatsapp_status_select on public.whatsapp_status
  for select to authenticated
  using ((select public.perfil_atual()) in ('dona', 'recepcao'));

create function public.gravar_status_whatsapp(p_estado text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.whatsapp_status set estado = p_estado, verificado_em = now();
$$;

revoke execute on function public.gravar_status_whatsapp(text) from public, anon, authenticated;
grant execute on function public.gravar_status_whatsapp(text) to service_role;

-- Chamado pelo pg_cron a cada minuto: POST em <url>/api/whatsapp/processar
-- com o token. URL nula ou pg_net ausente → nada. Nunca falha (vira WARNING).
create function public.disparar_relogio_whatsapp()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_token text;
begin
  select r.url, r.token into v_url, v_token from public.whatsapp_relogio r;
  if v_url is null then
    return;
  end if;
  if to_regprocedure('net.http_post(text, jsonb, jsonb, jsonb, integer)') is null then
    raise notice 'WhatsApp: pg_net não está instalada; o relógio não fará nada.';
    return;
  end if;

  begin
    execute $sql$
      select net.http_post(
        url := $1,
        body := '{}'::jsonb,
        headers := jsonb_build_object('x-cron-token', $2, 'content-type', 'application/json'),
        timeout_milliseconds := 25000
      )
    $sql$ using rtrim(v_url, '/') || '/api/whatsapp/processar', v_token;
  exception when others then
    raise warning 'WhatsApp: não foi possível disparar o relógio: %', sqlerrm;
  end;
end;
$$;

revoke execute on function public.disparar_relogio_whatsapp()
  from public, anon, authenticated, service_role;

-- Jobs (só onde pg_cron existe — Supabase; no Postgres local dos testes é um
-- no-op, como em 0009). cron.schedule com o mesmo nome atualiza o job. pg_net
-- é criada se disponível; sem ela o relógio não faz nada.
--   whatsapp_relogio      * * * * *   disparar_relogio_whatsapp()
--   whatsapp_aniversarios 0 12 * * *  enfileirar_aniversarios() (09:00 SP)
--   limpar_historico_cron 17 6 * * *  apaga cron.job_run_details com mais de
--                                     7 dias (o relógio grava ~1440 linhas/dia)
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_net') then
    begin
      create extension if not exists pg_net with schema extensions;
    exception when others then
      raise notice 'pg_net indisponível; o relógio do WhatsApp não fará nada: %', sqlerrm;
    end;
  end if;

  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    begin
      create extension if not exists pg_cron with schema pg_catalog;
      perform cron.schedule(
        'whatsapp_relogio',
        '* * * * *',
        $cron$select public.disparar_relogio_whatsapp();$cron$
      );
      perform cron.schedule(
        'whatsapp_aniversarios',
        '0 12 * * *',
        $cron$select public.enfileirar_aniversarios();$cron$
      );
      perform cron.schedule(
        'limpar_historico_cron',
        '17 6 * * *',
        $cron$delete from cron.job_run_details where end_time < now() - interval '7 days';$cron$
      );
    exception when others then
      raise notice 'pg_cron indisponível; agende whatsapp_relogio, whatsapp_aniversarios e limpar_historico_cron à mão: %', sqlerrm;
    end;
  end if;
end
$$;
