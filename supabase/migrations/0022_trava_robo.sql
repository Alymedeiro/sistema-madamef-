-- =============================================================================
-- 0022_trava_robo — travas de segurança do robô de atendimento.
--
-- Motivo: com o robô ligado em "sempre", toda cliente que escrevia recebia o
-- menu, inclusive no meio de conversas com a equipe.
--
--   1. Limite: no máximo 10 respostas do robô por hora (fila tipo 'robo').
--      Passou disso, o robô se desliga (robo_config.ativo = false) e dona e
--      recepção recebem um aviso no sininho.
--   2. Menu espontâneo (sem a cliente digitar '0' ou 'menu') só quando:
--      - o último menu para o número foi há mais de 24 h (antes: 12 h);
--      - o número não mandou outra mensagem nas 12 h anteriores (conversa
--        já em andamento, provavelmente com a equipe);
--      - a cliente não tem agendamento pendente/confirmado de 12 h atrás até
--        36 h à frente (hoje/amanhã), nem atendimento nos últimos 7 dias.
--      Respostas a opções do menu e '0'/'menu' continuam como antes.
--   3. "Não entendi" só nas 2 h seguintes ao menu (mesma validade das
--      opções); depois disso, mensagem que não é opção não recebe resposta.
--   robo_processar: corpo de 0017 com as três travas.
-- =============================================================================
set lock_timeout = '5s';

create index mensagens_recebidas_telefone_idx
  on public.mensagens_recebidas (telefone, recebida_em desc);
create index fila_mensagens_robo_criado_idx
  on public.fila_mensagens (criado_em) where tipo = 'robo';

-- Conversa em andamento: outra mensagem recebida do número nas últimas 12 h,
-- ou cliente com agendamento perto (pendente/confirmado de -12 h a +36 h) ou
-- atendida nos últimos 7 dias.
create function public.robo_conversa_em_andamento(
  p_formas text[],
  p_cliente uuid,
  p_recebida uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.mensagens_recebidas r
    where r.telefone = any (p_formas)
      and r.id <> p_recebida
      and r.recebida_em > now() - interval '12 hours'
  )
  or (p_cliente is not null and exists (
    select 1 from public.agendamentos a
    where a.cliente_id = p_cliente
      and (
        (a.status in ('pendente', 'confirmado')
         and a.inicio between now() - interval '12 hours' and now() + interval '36 hours')
        or (a.status = 'atendido' and a.inicio > now() - interval '7 days')
      )
  ))
$$;

revoke execute on function public.robo_conversa_em_andamento(text[], uuid, uuid)
  from public, anon, authenticated, service_role;

create or replace function public.robo_processar(p_recebida uuid)
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
  -- Trava 1: no máximo 10 respostas do robô por hora. Passou disso,
  -- o robô se desliga sozinho e a equipe é avisada no sininho.
  if (select count(*) from public.fila_mensagens f
      where f.tipo = 'robo' and f.criado_em > now() - interval '1 hour') >= 10 then
    update public.robo_config r set ativo = false where r.linha_unica and r.ativo;
    if found then
      perform public.notificar(
        'mensagem_falhou',
        'Robô desligado por segurança',
        'O robô respondeu 10 vezes na última hora e foi desligado. Confira em Configurações antes de ligar de novo.',
        '/configuracoes#robo',
        true
      );
    end if;
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
        or v_sessao.menu_enviado_em < now() - interval '24 hours' then
    -- Trava 2: menu que a cliente não pediu ('0'/'menu') só no começo de
    -- conversa e fora de atendimento em andamento.
    if not v_menu and public.robo_conversa_em_andamento(v_formas, v_rec.cliente_id, v_rec.id) then
      return;
    end if;
    v_menu := true;
  elsif v_sessao.menu_enviado_em > now() - interval '2 hours'
        and (v_sessao.nao_entendi_em is null or v_sessao.nao_entendi_em < v_sessao.menu_enviado_em) then
    -- Trava 3: "não entendi" só logo depois do menu (2 h, como as opções).
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
