-- =============================================================================
-- 0017_robo — robô de atendimento por menu (sem IA)
--
--   1. Configuração (robo_config, linha única), opções do menu (robo_opcoes,
--      sementes 1–4) e sessões por telefone (robo_sessoes), com RLS: dona e
--      recepção leem; só a dona altera configuração e opções; sessões só
--      pelas funções. salvar_robo grava tudo de uma vez (só a dona).
--   2. Fila: tipo 'robo' com texto pronto (como a avulsa), proxima_mensagem
--      (corpo de 0015) com o robô primeiro na ordem, também fora da janela de
--      envio, validade de 1 h, e retorno/reativação de cliente desativada
--      cancelados; reenviar_mensagem (corpo de 0015) copiando o texto do robô.
--   3. robo_processar, chamado ao final de registrar_recebida (corpo de 0012;
--      erro no robô vira WARNING e nunca falha o registro); pausa pela equipe
--      (gatilho na avulsa com autor), retomar_robo e robo_pedidos_atendimento.
--
-- Regras do robô (nesta ordem; a primeira que decide encerra):
--   1. Nada se o robô está inativo, se o WhatsApp está desligado, ou se
--      quando = 'fora_do_horario' e agora (SP) está dentro do
--      horario_funcionamento do dia (jsonb {"0".."6": [{inicio, fim}]},
--      0 = domingo; [inicio, fim)).
--   2. Nada se a recebida é 'confirmou'/'quer_remarcar' com agendamento (a
--      resposta da confirmação tem prioridade; registrar_recebida já tratou).
--      O dígito só é resposta de confirmação se a última enviada ao telefone
--      entre {confirmação, robô} foi a confirmação; se foi o robô (nas últimas
--      2 h), registrar_recebida classifica 'para_ler' e o robô responde.
--   3. Telefone: o WhatsApp da cliente encontrada, senão o recebido; fora de
--      ^55\d{10,11}$ → nada. Nada se a sessão está pausada (pausado_ate > agora).
--   4. Texto normalizado (trim, minúsculas, sem acento): '0' ou 'menu' →
--      menu. Dígito 1–8 (com ou sem ponto) de opção ativa, com o menu enviado
--      nas últimas 2 h → resposta da opção.
--   5. Sem menu, ou menu enviado há mais de 12 h → menu.
--   6. Senão, 'não entendi' uma vez por menu (nao_entendi_em nulo ou anterior
--      ao menu); depois, nada.
--
-- Textos: {nome} (primeiro nome; sem nome, some junto com a vírgula e o
-- espaço antes: "Oi, {nome}!" → "Oi!"), {clinica}, {endereco} e {horario}
-- (horario_funcionamento por extenso: "seg a sex 09:00 às 18:00; sáb 09:00
-- às 13:00"). Menu = boas-vindas + linha em branco + "N - rótulo" das opções
-- ativas em ordem. Opção texto = resposta + "\n\n" + rodapé (rodapé vazio →
-- só a resposta); agendar_online = "Agende pelo link: <link>" + rodapé, com
-- link = robo_config.link_agendamento ou whatsapp_relogio.url + '/agendar';
-- falar_com_equipe = mensagem fixa e pausa de 24 h (pediu_equipe_em = agora).
--
-- Dependências: 0001_base, 0012_whatsapp, 0015_crm (proxima_mensagem e
-- reenviar_mensagem mais recentes), 0016_robo_tipos (valor 'robo').
-- =============================================================================

-- =============================================================================
-- 1. Configuração, opções e sessões
-- =============================================================================

create table public.robo_config (
  linha_unica boolean primary key default true check (linha_unica),
  ativo boolean not null default false,
  quando text not null default 'sempre' check (quando in ('sempre', 'fora_do_horario')),
  boas_vindas text not null
    default 'Oi, {nome}! 💕 Sou a assistente virtual da {clinica}. Escolha uma opção digitando o número:'
    check (char_length(btrim(boas_vindas)) between 1 and 1000),
  nao_entendi text not null
    default 'Não entendi 😊 Digite o número de uma das opções ou 0 para ver o menu.'
    check (char_length(btrim(nao_entendi)) between 1 and 1000),
  -- Vazio = a resposta da opção vai sem rodapé.
  rodape_opcao text not null default 'Digite 0 para voltar ao menu.'
    check (char_length(rodape_opcao) <= 1000),
  -- Nulo = URL do site (whatsapp_relogio.url) + '/agendar'.
  link_agendamento text check (link_agendamento ~ '^https?://\S+$'),
  atualizado_em timestamptz not null default now()
);

insert into public.robo_config default values;

create trigger robo_config_atualizado_em before update on public.robo_config
  for each row execute function public.set_atualizado_em();

create table public.robo_opcoes (
  id uuid primary key default gen_random_uuid(),
  numero int not null unique check (numero between 1 and 8),
  rotulo text not null check (char_length(btrim(rotulo)) between 1 and 60),
  tipo text not null check (tipo in ('texto', 'agendar_online', 'falar_com_equipe')),
  resposta text check (char_length(resposta) <= 1000),
  ativo boolean not null default true,
  atualizado_em timestamptz not null default now(),
  constraint robo_opcoes_resposta_texto_check
    check (tipo <> 'texto' or char_length(btrim(coalesce(resposta, ''))) >= 1)
);

create trigger robo_opcoes_atualizado_em before update on public.robo_opcoes
  for each row execute function public.set_atualizado_em();

insert into public.robo_opcoes (numero, rotulo, tipo, resposta) values
  (1, 'Serviços e preços', 'texto',
   'Confira nossos serviços e valores: ... (edite este texto em Configurações → WhatsApp → Robô)'),
  (2, 'Agendar horário', 'agendar_online', null),
  (3, 'Endereço e horário', 'texto', 'Estamos em {endereco}. Horário: {horario}.'),
  (4, 'Falar com a equipe', 'falar_com_equipe', null);

create table public.robo_sessoes (
  telefone text primary key check (telefone ~ '^55\d{10,11}$'),
  cliente_id uuid references public.clientes (id),
  menu_enviado_em timestamptz,
  nao_entendi_em timestamptz,
  pausado_ate timestamptz,
  pediu_equipe_em timestamptz,
  atualizado_em timestamptz not null default now()
);

create index robo_sessoes_cliente_idx on public.robo_sessoes (cliente_id);
create index robo_sessoes_pediu_equipe_idx on public.robo_sessoes (pediu_equipe_em)
  where pediu_equipe_em is not null;

create trigger robo_sessoes_atualizado_em before update on public.robo_sessoes
  for each row execute function public.set_atualizado_em();

-- RLS. Configuração: dona e recepção leem; só a dona altera (linha única:
-- ninguém insere nem apaga). Opções: dona e recepção leem; só a dona cria,
-- altera e apaga. Sessões: dona e recepção leem; escrita só pelas funções.
alter table public.robo_config enable row level security;
alter table public.robo_opcoes enable row level security;
alter table public.robo_sessoes enable row level security;

revoke all on public.robo_config, public.robo_opcoes, public.robo_sessoes from anon, authenticated;
revoke insert, update, delete, truncate
  on public.robo_config, public.robo_opcoes, public.robo_sessoes from service_role;
grant select on public.robo_config, public.robo_opcoes, public.robo_sessoes to authenticated;
grant update (ativo, quando, boas_vindas, nao_entendi, rodape_opcao, link_agendamento)
  on public.robo_config to authenticated;
grant insert (numero, rotulo, tipo, resposta, ativo),
      update (numero, rotulo, tipo, resposta, ativo),
      delete
  on public.robo_opcoes to authenticated;

create policy robo_config_select on public.robo_config
  for select to authenticated
  using ((select public.perfil_atual()) in ('dona', 'recepcao'));
create policy robo_config_update on public.robo_config
  for update to authenticated
  using ((select public.perfil_atual()) = 'dona')
  with check ((select public.perfil_atual()) = 'dona');

create policy robo_opcoes_select on public.robo_opcoes
  for select to authenticated
  using ((select public.perfil_atual()) in ('dona', 'recepcao'));
create policy robo_opcoes_insert on public.robo_opcoes
  for insert to authenticated
  with check ((select public.perfil_atual()) = 'dona');
create policy robo_opcoes_update on public.robo_opcoes
  for update to authenticated
  using ((select public.perfil_atual()) = 'dona')
  with check ((select public.perfil_atual()) = 'dona');
create policy robo_opcoes_delete on public.robo_opcoes
  for delete to authenticated
  using ((select public.perfil_atual()) = 'dona');

create policy robo_sessoes_select on public.robo_sessoes
  for select to authenticated
  using ((select public.perfil_atual()) in ('dona', 'recepcao'));

-- Grava a configuração e substitui as opções (só a dona; P0001). p_opcoes:
-- [{numero, rotulo, tipo, resposta, ativo}], no máximo 8 (numero 1–8 único;
-- as restrições das tabelas valem). Link vazio vira nulo; textos com trim.
create function public.salvar_robo(
  p_ativo boolean,
  p_quando text,
  p_boas_vindas text,
  p_nao_entendi text,
  p_rodape_opcao text,
  p_link_agendamento text,
  p_opcoes jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.perfil_atual() is distinct from 'dona' then
    raise exception 'Apenas a dona pode alterar o robô.' using errcode = 'P0001';
  end if;
  if p_opcoes is null or jsonb_typeof(p_opcoes) <> 'array' then
    raise exception 'Opções inválidas.' using errcode = 'P0001';
  end if;

  update public.robo_config r
  set ativo = coalesce(p_ativo, false),
      quando = p_quando,
      boas_vindas = btrim(p_boas_vindas),
      nao_entendi = btrim(p_nao_entendi),
      rodape_opcao = btrim(coalesce(p_rodape_opcao, '')),
      link_agendamento = nullif(btrim(coalesce(p_link_agendamento, '')), '')
  where r.linha_unica;

  delete from public.robo_opcoes o where true;

  insert into public.robo_opcoes (numero, rotulo, tipo, resposta, ativo)
  select x.numero, btrim(x.rotulo), x.tipo,
         case when x.tipo = 'texto' then btrim(x.resposta) end,
         coalesce(x.ativo, true)
  from jsonb_to_recordset(p_opcoes)
    as x (numero int, rotulo text, tipo text, resposta text, ativo boolean)
  order by x.numero;
end;
$$;

revoke execute on function public.salvar_robo(boolean, text, text, text, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.salvar_robo(boolean, text, text, text, text, text, jsonb)
  to authenticated;

-- =============================================================================
-- 2. Fila: tipo 'robo'
-- =============================================================================

-- Texto pronto, como a avulsa.
alter table public.fila_mensagens
  add constraint fila_mensagens_robo_texto_check
  check (tipo <> 'robo' or texto is not null);

-- proxima_mensagem: corpo de 0015 (mesma assinatura e grants) com o robô:
-- sai primeiro, sai também fora da janela de envio (só ele; ritmo de 1/min,
-- limite por hora e whatsapp_ativo continuam valendo; fora da janela as
-- limpezas dos outros tipos esperam a janela) e vale 1 h (vencido →
-- 'Mensagem perdeu a validade'). O texto do robô já vem pronto (como a
-- avulsa).
create or replace function public.proxima_mensagem()
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
  v_fora_janela boolean;
  v_id uuid;
begin
  -- Serializa as execuções do relógio (a outra espera e depois vê o envio).
  perform pg_advisory_xact_lock(hashtext('whatsapp_proxima_mensagem'));

  select * into v_cfg from public.configuracoes_clinica limit 1;
  if not found or not v_cfg.whatsapp_ativo then
    return;
  end if;

  -- Fora da janela só sai o robô (a cliente acabou de escrever); ritmo e
  -- limite por hora valem para todos.
  v_hora := (now() at time zone 'America/Sao_Paulo')::time;
  v_fora_janela := v_hora < v_cfg.whatsapp_janela_inicio or v_hora >= v_cfg.whatsapp_janela_fim;

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

  -- Robô (0017): resposta com mais de 1 h de atraso não faz mais sentido.
  update public.fila_mensagens f
  set status = 'cancelada', cancelada_motivo = 'Mensagem perdeu a validade'
  where f.status = 'pendente'
    and f.tipo = 'robo'
    and f.agendado_para < now() - interval '1 hour';

  if not v_fora_janela then
    update public.fila_mensagens f
    set status = 'cancelada', cancelada_motivo = 'Modelo desativado'
    from public.modelos_mensagem m
    where m.tipo = f.tipo
      and not m.ativo
      and f.status = 'pendente'
      and f.agendado_para <= now();

    -- CRM (0015): retorno e reativação só saem para cliente ativa, com opt-in
    -- de marketing e se ela ainda não agendou.
    update public.fila_mensagens f
    set status = 'cancelada', cancelada_motivo = 'Cliente desativada'
    from public.clientes c
    where c.id = f.cliente_id
      and not c.ativo
      and f.status = 'pendente'
      and f.tipo in ('retorno', 'reativacao')
      and f.agendado_para <= now();

    update public.fila_mensagens f
    set status = 'cancelada', cancelada_motivo = 'Cliente sem opt-in de marketing'
    from public.clientes c
    where c.id = f.cliente_id
      and not c.aceita_whatsapp_marketing
      and f.status = 'pendente'
      and f.tipo in ('retorno', 'reativacao')
      and f.agendado_para <= now();

    update public.fila_mensagens f
    set status = 'cancelada', cancelada_motivo = 'Cliente já agendou'
    where f.status = 'pendente'
      and f.tipo in ('retorno', 'reativacao')
      and f.agendado_para <= now()
      and public.cliente_tem_agendamento_futuro(f.cliente_id);

    -- Envio desligado (ou parado) por dias: pós-atendimento, aniversário,
    -- respostas de pedido, retorno e reativação com mais de 24 h de atraso não
    -- fazem mais sentido.
    update public.fila_mensagens f
    set status = 'cancelada', cancelada_motivo = 'Mensagem perdeu a validade'
    where f.status = 'pendente'
      and f.tipo in ('pos_atendimento', 'aniversario', 'pedido_aprovado', 'pedido_recusado',
                     'retorno', 'reativacao')
      and f.agendado_para < now() - interval '24 hours';
  end if;

  select f.id into v_id
  from public.fila_mensagens f
  where f.status = 'pendente'
    and f.agendado_para <= now()
    and (f.proxima_tentativa_em is null or f.proxima_tentativa_em <= now())
    and (not v_fora_janela or f.tipo = 'robo')
  -- Robô (0017) primeiro: a cliente está esperando a resposta.
  order by (f.tipo = 'robo') desc, f.agendado_para, f.criado_em, f.id
  limit 1
  for update skip locked;

  if v_id is null then
    return;
  end if;

  update public.fila_mensagens f set status = 'enviando' where f.id = v_id;

  return query
  select f.id, f.tipo, f.telefone, f.texto, m.variacoes,
         coalesce(c.nome, p.nome, l.nome), s.nome, col.nome,
         coalesce(a.inicio, p.inicio), a.status, v_cfg.nome
  from public.fila_mensagens f
  left join public.modelos_mensagem m on m.tipo = f.tipo
  left join public.agendamentos a on a.id = f.agendamento_id
  left join public.pedidos_online p on p.id = f.pedido_online_id
  left join public.clientes c on c.id = f.cliente_id
  left join public.leads l on l.id = f.lead_id
  left join public.servicos s on s.id = coalesce(a.servico_id, p.servico_id)
  left join public.colaboradores col on col.id = coalesce(a.profissional_id, p.profissional_id)
  where f.id = v_id;
end;
$$;

revoke execute on function public.proxima_mensagem() from public, anon, authenticated;
grant execute on function public.proxima_mensagem() to service_role;

-- Reenvio: corpo de 0015 (mesma assinatura e grants), copiando também o
-- texto pronto do robô.
create or replace function public.reenviar_mensagem(p_id uuid)
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
      tipo, cliente_id, pedido_online_id, agendamento_id, lead_id, telefone, texto,
      agendado_para, criado_por
    ) values (
      v_msg.tipo, v_msg.cliente_id, v_msg.pedido_online_id, v_msg.agendamento_id,
      v_msg.lead_id, v_msg.telefone,
      case when v_msg.tipo in ('avulsa', 'robo') then v_msg.texto end,
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

-- =============================================================================
-- 3. Robô: textos, processamento, pausa e retomada
-- =============================================================================

-- horario_funcionamento por extenso, de segunda a domingo, agrupando dias
-- seguidos com os mesmos horários: "seg a sex 09:00 às 18:00; sáb 09:00 às
-- 13:00" (dois dias seguidos: "seg e ter"; vários intervalos: "09:00 às 12:00
-- e 14:00 às 18:00"). Dia ausente ou malformado = fechado. Nenhum dia aberto
-- → 'consulte a equipe'. Mesmo resultado de textoHorario (TS).
create function public.robo_texto_horario(p_horario jsonb)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_ordem int[] := array[1, 2, 3, 4, 5, 6, 0];
  v_nomes text[] := array['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
  v_partes text[] := '{}';
  v_atual text;
  v_ini int;
  v_fim int;
  v_txt text;
  v_lista jsonb;
  i int;
begin
  for i in 1..8 loop
    v_txt := null;
    if i <= 7 and p_horario is not null and jsonb_typeof(p_horario) = 'object' then
      v_lista := p_horario -> v_ordem[i]::text;
      if jsonb_typeof(v_lista) = 'array' then
        select string_agg(left(x ->> 'inicio', 5) || ' às ' || left(x ->> 'fim', 5), ' e '
                          order by left(x ->> 'inicio', 5))
        into v_txt
        from jsonb_array_elements(v_lista) x
        where jsonb_typeof(x) = 'object'
          and jsonb_typeof(x -> 'inicio') = 'string'
          and jsonb_typeof(x -> 'fim') = 'string';
      end if;
    end if;

    if v_txt is not null and v_txt = v_atual then
      v_fim := i;
    else
      if v_atual is not null then
        v_partes := v_partes || (
          v_nomes[v_ordem[v_ini] + 1]
          || case when v_fim = v_ini then ''
                  when v_fim = v_ini + 1 then ' e ' || v_nomes[v_ordem[v_fim] + 1]
                  else ' a ' || v_nomes[v_ordem[v_fim] + 1] end
          || ' ' || v_atual
        );
      end if;
      v_atual := v_txt;
      v_ini := i;
      v_fim := i;
    end if;
  end loop;

  if cardinality(v_partes) = 0 then
    return 'consulte a equipe';
  end if;
  return array_to_string(v_partes, '; ');
end;
$$;

revoke execute on function public.robo_texto_horario(jsonb) from public, anon;
grant execute on function public.robo_texto_horario(jsonb) to authenticated, service_role;

-- p_quando (hora de SP) cai em algum intervalo [inicio, fim) do dia?
create function public.robo_dentro_do_horario(p_horario jsonb, p_quando timestamptz)
returns boolean
language sql
immutable
set search_path = ''
as $$
  with agora as (select (p_quando at time zone 'America/Sao_Paulo') as l)
  select coalesce(jsonb_typeof(p_horario) = 'object', false) and exists (
    select 1
    from agora,
         jsonb_array_elements(
           case when jsonb_typeof(p_horario -> extract(dow from agora.l)::int::text) = 'array'
                then p_horario -> extract(dow from agora.l)::int::text
                else '[]'::jsonb end
         ) x
    where jsonb_typeof(x) = 'object'
      and x ->> 'inicio' ~ '^\d{2}:\d{2}(:\d{2})?$'
      and x ->> 'fim' ~ '^\d{2}:\d{2}(:\d{2})?$'
      and agora.l::time >= (x ->> 'inicio')::time
      and agora.l::time < (x ->> 'fim')::time
  )
$$;

revoke execute on function public.robo_dentro_do_horario(jsonb, timestamptz)
  from public, anon, authenticated, service_role;

-- Troca {nome} (primeiro nome; sem nome, some com a vírgula e o espaço
-- antes), {clinica}, {endereco} e {horario}. Desconhecida fica literal.
create function public.robo_renderizar(
  p_texto text, p_nome text, p_clinica text, p_endereco text, p_horario text
)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v text := coalesce(p_texto, '');
  v_nome text := (regexp_split_to_array(btrim(coalesce(p_nome, '')), '\s+'))[1];
begin
  if coalesce(v_nome, '') = '' then
    v := regexp_replace(v, ',?\s*\{nome\}', '', 'g');
  else
    v := replace(v, '{nome}', v_nome);
  end if;
  v := replace(v, '{clinica}', coalesce(p_clinica, ''));
  v := replace(v, '{endereco}', coalesce(p_endereco, ''));
  v := replace(v, '{horario}', coalesce(p_horario, ''));
  return btrim(v);
end;
$$;

revoke execute on function public.robo_renderizar(text, text, text, text, text)
  from public, anon, authenticated, service_role;

-- As duas formas de um WhatsApp brasileiro (com e sem o 9 depois do DDD),
-- como em registrar_recebida: 55DD+8 dígitos ↔ 55DD+9+8 dígitos. Outro
-- formato → só ele mesmo.
create function public.robo_telefones(p_telefone text)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select case
    when p_telefone ~ '^55\d{10}$' then
      array[p_telefone, left(p_telefone, 4) || '9' || substr(p_telefone, 5)]
    when p_telefone ~ '^55\d{2}9\d{8}$' then
      array[p_telefone, left(p_telefone, 4) || substr(p_telefone, 6)]
    else array[p_telefone]
  end
$$;

revoke execute on function public.robo_telefones(text) from public, anon;
grant execute on function public.robo_telefones(text) to authenticated, service_role;

-- Texto fixo da opção falar_com_equipe.
create function public.robo_texto_equipe()
returns text
language sql
immutable
set search_path = ''
as $$
  select 'Certo! Já avisei a equipe, em breve alguém te responde. 💕'::text
$$;

revoke execute on function public.robo_texto_equipe() from public, anon, authenticated, service_role;

-- Link de agendamento do site: whatsapp_relogio.url + '/agendar' (nulo sem
-- URL). Dona e recepção (prévia em Configurações); o token não sai daqui.
create function public.robo_link_site()
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if public.perfil_atual() is null or public.perfil_atual() not in ('dona', 'recepcao') then
    return null;
  end if;
  return (select rtrim(r.url, '/') || '/agendar' from public.whatsapp_relogio r);
end;
$$;

revoke execute on function public.robo_link_site() from public, anon, authenticated;
grant execute on function public.robo_link_site() to authenticated;

-- O robô responderia agora? Ativo, WhatsApp ligado e, em 'fora_do_horario',
-- fora do horário de funcionamento (regra 1).
create function public.robo_atende_agora()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select r.ativo and cc.whatsapp_ativo
       and not (r.quando = 'fora_do_horario'
                and public.robo_dentro_do_horario(cc.horario_funcionamento, now()))
    from public.robo_config r
    cross join (select * from public.configuracoes_clinica limit 1) cc
    where r.linha_unica
  ), false)
$$;

revoke execute on function public.robo_atende_agora() from public, anon, authenticated, service_role;

-- Processa uma resposta recebida (regras no cabeçalho). Interna: chamada só
-- por registrar_recebida.
create function public.robo_processar(p_recebida uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cfg public.robo_config;
  v_cc public.configuracoes_clinica;
  v_rec public.mensagens_recebidas;
  v_sessao public.robo_sessoes;
  v_opcao public.robo_opcoes;
  v_telefone text;
  v_destino text;
  v_formas text[];
  v_nome text;
  v_norm text;
  v_horario text;
  v_link text;
  v_resposta text;
  v_menu boolean := false;
begin
  if not public.robo_atende_agora() then
    return;
  end if;
  select * into v_cfg from public.robo_config r where r.linha_unica;
  select * into v_cc from public.configuracoes_clinica limit 1;

  select * into v_rec from public.mensagens_recebidas r where r.id = p_recebida;
  if not found then
    return;
  end if;

  if v_rec.classificacao in ('confirmou', 'quer_remarcar') and v_rec.agendamento_id is not null then
    return;
  end if;

  select c.whatsapp, c.nome into v_telefone, v_nome
  from public.clientes c where c.id = v_rec.cliente_id;
  v_telefone := coalesce(v_telefone, v_rec.telefone);
  if v_telefone !~ '^55\d{10,11}$' then
    return;
  end if;

  -- Sessão: a que já existe com qualquer forma do número (com ou sem o 9;
  -- a do próprio número primeiro), senão uma nova. Cria ou trava a sessão
  -- (duas respostas seguidas são serializadas).
  -- A resposta vai para o número da cliente (ou o que escreveu); a sessão
  -- pode estar guardada na outra forma.
  v_destino := v_telefone;
  v_formas := public.robo_telefones(v_telefone);
  v_telefone := coalesce(
    (select s.telefone from public.robo_sessoes s
     where s.telefone = any (v_formas)
     order by (s.telefone = v_telefone) desc
     limit 1),
    v_telefone
  );
  insert into public.robo_sessoes as s (telefone, cliente_id)
  values (v_telefone, v_rec.cliente_id)
  on conflict (telefone) do update
    set cliente_id = coalesce(excluded.cliente_id, s.cliente_id)
  returning * into v_sessao;

  if exists (
    select 1 from public.robo_sessoes s
    where s.telefone = any (v_formas) and s.pausado_ate > now()
  ) then
    return;
  end if;

  v_horario := public.robo_texto_horario(v_cc.horario_funcionamento);
  v_norm := lower(translate(
    btrim(v_rec.texto),
    'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
    'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC'
  ));

  if v_norm in ('0', 'menu') then
    v_menu := true;
  elsif v_norm ~ '^[1-8]\.?$' and v_sessao.menu_enviado_em > now() - interval '2 hours' then
    select * into v_opcao from public.robo_opcoes o
    where o.numero = left(v_norm, 1)::int and o.ativo;
  end if;

  if v_opcao.id is not null then
    if v_opcao.tipo = 'falar_com_equipe' then
      v_resposta := public.robo_texto_equipe();
      update public.robo_sessoes s
      set pausado_ate = now() + interval '24 hours', pediu_equipe_em = now()
      where s.telefone = v_telefone;
    else
      if v_opcao.tipo = 'agendar_online' then
        v_link := coalesce(
          v_cfg.link_agendamento,
          (select rtrim(r.url, '/') || '/agendar' from public.whatsapp_relogio r)
        );
        v_resposta := case when v_link is null
          then 'Para agendar, responda esta mensagem que a equipe te ajuda.'
          else 'Agende pelo link: ' || v_link end;
      else
        v_resposta := public.robo_renderizar(
          v_opcao.resposta, v_nome, v_cc.nome, v_cc.endereco, v_horario
        );
      end if;
      if btrim(v_cfg.rodape_opcao) <> '' then
        v_resposta := v_resposta || E'\n\n' || public.robo_renderizar(
          v_cfg.rodape_opcao, v_nome, v_cc.nome, v_cc.endereco, v_horario
        );
      end if;
    end if;
  elsif exists (
    -- Confirmação enviada nas últimas 24 h e agendamento ainda pendente: nem
    -- menu nem "não entendi" (o "1" que vier depois confirma).
    select 1
    from public.fila_mensagens f
    join public.agendamentos a on a.id = f.agendamento_id
    where f.telefone = any (v_formas)
      and f.tipo = 'confirmacao'
      and f.status = 'enviada'
      and f.enviada_em > now() - interval '24 hours'
      and a.status = 'pendente'
  ) then
    return;
  elsif v_menu
        or v_sessao.menu_enviado_em is null
        or v_sessao.menu_enviado_em < now() - interval '12 hours' then
    v_menu := true;
  elsif v_sessao.nao_entendi_em is null or v_sessao.nao_entendi_em < v_sessao.menu_enviado_em then
    v_resposta := public.robo_renderizar(
      v_cfg.nao_entendi, v_nome, v_cc.nome, v_cc.endereco, v_horario
    );
    update public.robo_sessoes s set nao_entendi_em = now() where s.telefone = v_telefone;
  else
    return;
  end if;

  if v_menu then
    select public.robo_renderizar(v_cfg.boas_vindas, v_nome, v_cc.nome, v_cc.endereco, v_horario)
           || coalesce(E'\n\n' || string_agg(o.numero || ' - ' || o.rotulo, E'\n' order by o.numero), '')
    into v_resposta
    from public.robo_opcoes o
    where o.ativo;
    update public.robo_sessoes s set menu_enviado_em = now() where s.telefone = v_telefone;
  end if;

  insert into public.fila_mensagens (tipo, cliente_id, telefone, texto, agendado_para)
  values ('robo', v_rec.cliente_id, v_destino, v_resposta, now());
end;
$$;

revoke execute on function public.robo_processar(uuid) from public, anon, authenticated, service_role;

-- registrar_recebida: corpo de 0012 (mesma assinatura e grants) mais: dígito
-- depois de mensagem do robô não é resposta de confirmação (ver abaixo) e, ao
-- final de uma resposta nova, o robô.
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

  if v_classificacao = 'confirmou' and v_status = 'pendente' then
    update public.agendamentos a set status = 'confirmado'
    where a.id = v_agendamento and a.status = 'pendente';
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

-- Pausa pela equipe: avulsa com autor (enviar_avulsa, enviar_avulsa_lead,
-- reenvio) pausa o robô por 24 h no telefone, com e sem o 9 (cria a sessão
-- se preciso).
-- Nunca falha o envio.
create function public.robo_pausar_pela_equipe()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    -- Pausa as sessões do número (com e sem o 9); sem nenhuma, cria.
    update public.robo_sessoes s
    set pausado_ate = greatest(s.pausado_ate, now() + interval '24 hours'),
        cliente_id = coalesce(s.cliente_id, new.cliente_id)
    where s.telefone = any (public.robo_telefones(new.telefone));
    if not found then
      insert into public.robo_sessoes as s (telefone, cliente_id, pausado_ate)
      values (new.telefone, new.cliente_id, now() + interval '24 hours')
      on conflict (telefone) do update
        set pausado_ate = greatest(s.pausado_ate, excluded.pausado_ate),
            cliente_id = coalesce(s.cliente_id, excluded.cliente_id);
    end if;
  exception when others then
    raise warning 'Robô: não foi possível pausar o atendimento de %: %', new.telefone, sqlerrm;
  end;
  return null;
end;
$$;

revoke execute on function public.robo_pausar_pela_equipe() from public, anon, authenticated;

create trigger fila_mensagens_robo_pausa
  after insert on public.fila_mensagens
  for each row
  when (new.tipo = 'avulsa' and new.criado_por is not null)
  execute function public.robo_pausar_pela_equipe();

-- Retoma o robô no telefone, com e sem o 9 (dona e recepção): limpa a pausa
-- e o pedido de atendimento. Sem sessão → nada.
create function public.retomar_robo(p_telefone text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.exigir_equipe_whatsapp();

  update public.robo_sessoes s
  set pausado_ate = null, pediu_equipe_em = null
  where s.telefone = any (public.robo_telefones(p_telefone));
end;
$$;

revoke execute on function public.retomar_robo(text) from public, anon, authenticated;
grant execute on function public.retomar_robo(text) to authenticated;

-- Quantas pediram atendimento (opção falar_com_equipe) nas últimas 24 h e
-- ainda não receberam avulsa da equipe (no número com ou sem o 9) depois do
-- pedido. Com RLS de quem
-- chama: profissional vê 0.
create function public.robo_pedidos_atendimento()
returns int
language sql
stable
set search_path = ''
as $$
  select count(*)::int
  from public.robo_sessoes s
  where s.pediu_equipe_em > now() - interval '24 hours'
    and not exists (
      select 1 from public.fila_mensagens f
      where f.telefone = any (public.robo_telefones(s.telefone))
        and f.tipo = 'avulsa'
        and f.criado_por is not null
        and f.status <> 'cancelada'
        and f.criado_em > s.pediu_equipe_em
    )
$$;

revoke execute on function public.robo_pedidos_atendimento() from public, anon, authenticated;
grant execute on function public.robo_pedidos_atendimento() to authenticated;
