-- =============================================================================
-- 0009_agendamento_online — Fase 3A: pedidos de horário pela página /agendar
--
--   1. Configurações: online_ativo e texto do aviso de privacidade.
--   2. Tabela pedidos_online: o pedido segura o horário por 24 h (exclusion
--      constraint entre pedidos aguardando); RLS sem acesso de anon e sem
--      escrita direta (só funções security definer).
--   3. Vencimento, expiração e limpeza LGPD (90 dias), leitura para a agenda
--      sem WhatsApp, e o gatilho que impede agendamento interno sobre um
--      pedido aguardando não vencido.
--   4. Tarefa diária (pg_cron, só onde a extensão existe).
--   5. horarios_livres_online (service_role).
--   6. criar_pedido_online com trava por profissional (service_role).
--   7. aprovar_pedido_online e recusar_pedido_online (dona e recepção).
--
-- Pedido "vencido" = status 'aguardando' e criado_em <= now() - 24 h. Vencido
-- nunca bloqueia horário, em nenhuma função ou gatilho.
--
-- Dependências: 0001_base (configuracoes_clinica, colaboradores, servicos,
-- perfil_atual, colaborador_atual_id, set_atualizado_em, btree_gist),
-- 0002_agenda (agendamentos).
-- =============================================================================

-- =============================================================================
-- 1. Configurações
-- =============================================================================
alter table public.configuracoes_clinica
  add column online_ativo boolean not null default false,
  add column online_aviso_privacidade text not null default
    'Usamos seu nome e WhatsApp só para responder este pedido de horário. Se o pedido não virar atendimento, apagamos esses dados em até 90 dias.';

-- =============================================================================
-- 2. Tabela pedidos_online
-- =============================================================================
create type public.status_pedido_online as enum (
  'aguardando', 'aprovado', 'recusado', 'expirado'
);

create table public.pedidos_online (
  id uuid primary key default gen_random_uuid(),
  servico_id uuid not null references public.servicos (id),
  -- null = "qualquer uma".
  profissional_escolhida_id uuid references public.colaboradores (id),
  -- Profissional atribuída (a escolhida ou a primeira livre).
  profissional_id uuid not null references public.colaboradores (id),
  inicio timestamptz not null,
  fim timestamptz not null,
  avaliacao boolean not null default false,
  -- nome e whatsapp ficam nulos depois da limpeza LGPD.
  nome text check (char_length(btrim(nome)) between 2 and 80),
  -- Só dígitos, com DDI (55 + DDD + número).
  whatsapp text check (whatsapp ~ '^\d{12,13}$'),
  status public.status_pedido_online not null default 'aguardando',
  motivo_recusa text check (char_length(motivo_recusa) <= 200),
  agendamento_id uuid unique references public.agendamentos (id),
  decidido_por uuid references public.colaboradores (id),
  decidido_em timestamptz,
  aceite_privacidade_em timestamptz not null,
  -- HMAC-SHA256 do IP; o IP nunca é gravado.
  ip_hash text not null,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  dados_apagados_em timestamptz,
  constraint pedidos_online_intervalo_check check (fim > inicio),
  -- Uma profissional nunca tem dois pedidos aguardando sobrepostos. Vencidos
  -- ainda 'aguardando' também entram: quem insere expira antes
  -- (expirar_pedidos_online). Violação: SQLSTATE 23P01.
  constraint pedidos_online_sem_sobreposicao exclude using gist (
    profissional_id extensions.gist_uuid_ops with =,
    tstzrange(inicio, fim, '[)') with &&
  ) where (status = 'aguardando')
);

create index pedidos_online_servico_idx on public.pedidos_online (servico_id);
create index pedidos_online_profissional_escolhida_idx
  on public.pedidos_online (profissional_escolhida_id);
create index pedidos_online_profissional_inicio_idx
  on public.pedidos_online (profissional_id, inicio);
create index pedidos_online_decidido_por_idx on public.pedidos_online (decidido_por);
create index pedidos_online_whatsapp_aguardando_idx
  on public.pedidos_online (whatsapp) where status = 'aguardando';
create index pedidos_online_ip_hash_criado_idx on public.pedidos_online (ip_hash, criado_em);
create index pedidos_online_status_criado_idx on public.pedidos_online (status, criado_em);

create trigger pedidos_online_atualizado_em before update on public.pedidos_online
  for each row execute function public.set_atualizado_em();

-- RLS: anon sem nenhum privilégio; authenticated só lê (dona e recepção).
-- Escrita só pelas funções security definer (seções 3 e 5–7).
alter table public.pedidos_online enable row level security;

revoke all on public.pedidos_online from anon;
revoke insert, update, delete, truncate on public.pedidos_online from authenticated;

create policy pedidos_online_select on public.pedidos_online
  for select to authenticated
  using ((select public.perfil_atual()) in ('dona', 'recepcao'));

-- =============================================================================
-- 3. Vencimento, expiração, limpeza, leitura da agenda e gatilho
-- =============================================================================

-- Única definição de "vencido", usada por todas as funções e gatilhos.
create function public.pedido_vencido(p public.pedidos_online)
returns boolean
language sql
stable
set search_path = ''
as $$
  select p.status = 'aguardando'
     and p.criado_em <= now() - interval '24 hours'
$$;

revoke execute on function public.pedido_vencido(public.pedidos_online)
  from public, anon, authenticated;
grant execute on function public.pedido_vencido(public.pedidos_online)
  to authenticated, service_role;

-- Grava 'expirado' nos vencidos; devolve quantos. Chamada ao listar e pela
-- tarefa diária.
create function public.expirar_pedidos_online()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n int;
begin
  update public.pedidos_online p
  set status = 'expirado'
  where public.pedido_vencido(p);
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke execute on function public.expirar_pedidos_online() from public, anon, authenticated;
grant execute on function public.expirar_pedidos_online() to authenticated, service_role;

-- LGPD: pedidos não aprovados com mais de 90 dias perdem nome e WhatsApp.
-- Só a tarefa diária (service_role / postgres).
create function public.apagar_dados_pedidos_antigos()
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
  return v_n;
end;
$$;

revoke execute on function public.apagar_dados_pedidos_antigos() from public, anon, authenticated;
grant execute on function public.apagar_dados_pedidos_antigos() to service_role;

-- Blocos 🟡 da agenda: pedidos aguardando não vencidos que tocam [p_de, p_ate).
-- Dona e recepção veem todos; profissional só os próprios. Sem WhatsApp.
create function public.pedidos_online_da_agenda(p_de timestamptz, p_ate timestamptz)
returns table (
  id uuid,
  profissional_id uuid,
  servico_id uuid,
  inicio timestamptz,
  fim timestamptz,
  primeiro_nome text,
  avaliacao boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.profissional_id, p.servico_id, p.inicio, p.fim,
         split_part(btrim(p.nome), ' ', 1), p.avaliacao
  from public.pedidos_online p
  where p.status = 'aguardando'
    and not public.pedido_vencido(p)
    and p.inicio < p_ate
    and p.fim > p_de
    and (
      public.perfil_atual() in ('dona', 'recepcao')
      or (
        public.perfil_atual() = 'profissional'
        and p.profissional_id = public.colaborador_atual_id()
      )
    )
  order by p.inicio, p.id
$$;

revoke execute on function public.pedidos_online_da_agenda(timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function public.pedidos_online_da_agenda(timestamptz, timestamptz)
  to authenticated;

-- Trava da agenda de uma profissional até o fim da transação. Serializa quem
-- confere e grava horário da mesma profissional (gatilho de agendamentos,
-- criar_pedido_online, aprovar_pedido_online): sem ela, em READ COMMITTED,
-- um agendamento e um pedido simultâneos não se enxergam e ambos gravam.
-- Chamada só por funções security definer e gatilhos.
create function public.travar_agenda_profissional(p_profissional uuid)
returns void
language plpgsql
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtext('agenda:' || p_profissional::text));
end;
$$;

revoke execute on function public.travar_agenda_profissional(uuid)
  from public, anon, authenticated;

-- Agendamento (não cancelado) não pode cair sobre um pedido aguardando não
-- vencido da mesma profissional. A aprovação do próprio pedido passa: o
-- pedido muda de status na mesma transação, antes do insert. Antes de
-- conferir, trava a agenda da profissional (travar_agenda_profissional).
-- Mudança só de status entre estados ativos (ex.: confirmado → atendido) não
-- é conferida: o horário não mudou. security definer: a profissional não lê
-- pedidos_online.
create function public.agendamentos_pedido_online()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
     and old.status <> 'cancelado'
     and new.inicio = old.inicio
     and new.fim = old.fim
     and new.profissional_id = old.profissional_id then
    return new;
  end if;
  perform public.travar_agenda_profissional(new.profissional_id);
  if exists (
    select 1
    from public.pedidos_online p
    where p.profissional_id = new.profissional_id
      and p.status = 'aguardando'
      and not public.pedido_vencido(p)
      and tstzrange(p.inicio, p.fim, '[)') && tstzrange(new.inicio, new.fim, '[)')
  ) then
    raise exception 'Há um pedido online neste horário. Aprove ou recuse o pedido primeiro.'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

revoke execute on function public.agendamentos_pedido_online() from public, anon, authenticated;

create trigger agendamentos_pedido_online
  before insert or update of inicio, fim, profissional_id, status on public.agendamentos
  for each row
  when (new.status <> 'cancelado')
  execute function public.agendamentos_pedido_online();

-- =============================================================================
-- 4. Tarefa diária (pg_cron)
--
-- 06:00 UTC = 03:00 em São Paulo: expira os vencidos e apaga os dados antigos.
-- Só age onde pg_cron está disponível (Supabase); no Postgres local dos testes
-- é um no-op. cron.schedule com o mesmo nome atualiza o job existente. Falha
-- ao criar a extensão ou o job vira aviso (notice), sem derrubar a migração.
-- =============================================================================
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    begin
      create extension if not exists pg_cron with schema pg_catalog;
      perform cron.schedule(
        'pedidos_online_limpeza',
        '0 6 * * *',
        $cron$select public.expirar_pedidos_online(); select public.apagar_dados_pedidos_antigos();$cron$
      );
    exception when others then
      raise notice 'pg_cron indisponível; agende pedidos_online_limpeza à mão: %', sqlerrm;
    end;
  end if;
end
$$;

-- =============================================================================
-- 5. Horários livres (página /agendar)
--
-- Início a cada 15 min dentro de cada intervalo de jornada do dia da semana,
-- com inicio + duração <= fim do intervalo, inicio >= now() + antecedência
-- mínima e p_dia em [hoje, hoje + antecedência máxima] (hoje em São Paulo).
-- Livre = sem agendamento não cancelado, bloqueio ou pedido aguardando não
-- vencido sobreposto ('[)'). Vazio se online desligado ou serviço inativo/sem
-- permite_online. Profissional: ativa e com o serviço em colaborador_servicos.
-- p_profissional null = "qualquer uma": uma linha por horário, com a primeira
-- profissional livre por nome (desempate por id — Ruling P3A-R1).
-- Só o servidor (service_role).
-- =============================================================================
create function public.horarios_livres_online(p_servico uuid, p_profissional uuid, p_dia date)
returns table (inicio timestamptz, profissional_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  with cfg as (
    select c.online_antecedencia_min_horas as min_h,
           c.online_antecedencia_max_dias as max_d,
           (now() at time zone 'America/Sao_Paulo')::date as hoje
    from public.configuracoes_clinica c
    where c.online_ativo
    limit 1
  ),
  srv as (
    select make_interval(mins => s.duracao_min) as duracao
    from public.servicos s
    where s.id = p_servico and s.ativo and s.permite_online
  ),
  candidatos as (
    select co.id as profissional_id, co.nome, g.t as inicio, g.t + srv.duracao as fim
    from cfg
    cross join srv
    cross join public.colaboradores co
    join public.colaborador_servicos cs
      on cs.colaborador_id = co.id and cs.servico_id = p_servico
    join public.jornadas j
      on j.colaborador_id = co.id and j.dia_semana = extract(dow from p_dia)
    cross join lateral generate_series(
      (p_dia + j.hora_inicio) at time zone 'America/Sao_Paulo',
      ((p_dia + j.hora_fim) at time zone 'America/Sao_Paulo') - srv.duracao,
      interval '15 minutes'
    ) as g(t)
    where co.ativo
      and (p_profissional is null or co.id = p_profissional)
      and p_dia between cfg.hoje and cfg.hoje + cfg.max_d
      and g.t >= now() + make_interval(hours => cfg.min_h)
  )
  select distinct on (k.inicio) k.inicio, k.profissional_id
  from candidatos k
  where not exists (
      select 1 from public.agendamentos a
      where a.profissional_id = k.profissional_id
        and a.status <> 'cancelado'
        and tstzrange(a.inicio, a.fim, '[)') && tstzrange(k.inicio, k.fim, '[)')
    )
    and not exists (
      select 1 from public.bloqueios_agenda b
      where b.colaborador_id = k.profissional_id
        and tstzrange(b.inicio, b.fim, '[)') && tstzrange(k.inicio, k.fim, '[)')
    )
    and not exists (
      select 1 from public.pedidos_online p
      where p.profissional_id = k.profissional_id
        and p.status = 'aguardando'
        and not public.pedido_vencido(p)
        and tstzrange(p.inicio, p.fim, '[)') && tstzrange(k.inicio, k.fim, '[)')
    )
  order by k.inicio, k.nome, k.profissional_id
$$;

revoke execute on function public.horarios_livres_online(uuid, uuid, date)
  from public, anon, authenticated;
grant execute on function public.horarios_livres_online(uuid, uuid, date) to service_role;

-- =============================================================================
-- 6. Criar pedido (página /agendar, pelo servidor)
--
-- Ordem: online ligado; limite por ip_hash (5 na última hora); expira os
-- vencidos (senão a exclusion constraint recusaria o horário); limite por
-- WhatsApp (3 aguardando); para cada candidata em ordem de nome (a escolhida,
-- ou todas as que fazem o serviço), trava a agenda dela
-- (travar_agenda_profissional — Ruling P3A-R2) e confere p_inicio em
-- horarios_livres_online; grava na primeira livre. Nenhuma livre, ou corrida
-- na constraint (23P01), vira "Esse horário acabou de ser reservado…".
-- Candidatas travadas em ordem fixa (nome, id): sem deadlock entre pedidos.
-- Só o servidor (service_role).
-- =============================================================================
create function public.criar_pedido_online(
  p_servico uuid,
  p_profissional uuid,
  p_inicio timestamptz,
  p_nome text,
  p_whatsapp text,
  p_ip_hash text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_servico public.servicos;
  v_dia date := (p_inicio at time zone 'America/Sao_Paulo')::date;
  v_prof uuid;
  v_id uuid;
begin
  if not coalesce(
    (select c.online_ativo from public.configuracoes_clinica c limit 1), false
  ) then
    raise exception 'Agendamento online indisponível no momento.' using errcode = 'P0001';
  end if;

  if (
    select count(*) from public.pedidos_online p
    where p.ip_hash = p_ip_hash and p.criado_em > now() - interval '1 hour'
  ) >= 5 then
    raise exception 'Muitas tentativas. Tente novamente mais tarde.' using errcode = 'P0001';
  end if;

  perform public.expirar_pedidos_online();

  if (
    select count(*) from public.pedidos_online p
    where p.whatsapp = p_whatsapp and p.status = 'aguardando'
  ) >= 3 then
    raise exception 'Você já tem 3 pedidos aguardando resposta. Aguarde o retorno da clínica.'
      using errcode = 'P0001';
  end if;

  select * into v_servico from public.servicos s where s.id = p_servico;

  for v_prof in
    select co.id
    from public.colaboradores co
    join public.colaborador_servicos cs
      on cs.colaborador_id = co.id and cs.servico_id = p_servico
    where co.ativo
      and (p_profissional is null or co.id = p_profissional)
    order by co.nome, co.id
  loop
    perform public.travar_agenda_profissional(v_prof);
    if exists (
      select 1 from public.horarios_livres_online(p_servico, v_prof, v_dia) h
      where h.inicio = p_inicio
    ) then
      begin
        insert into public.pedidos_online (
          servico_id, profissional_escolhida_id, profissional_id, inicio, fim,
          avaliacao, nome, whatsapp, aceite_privacidade_em, ip_hash
        ) values (
          p_servico, p_profissional, v_prof, p_inicio,
          p_inicio + make_interval(mins => v_servico.duracao_min),
          v_servico.exige_avaliacao, p_nome, p_whatsapp, now(), p_ip_hash
        )
        returning id into v_id;
      exception when exclusion_violation then
        raise exception 'Esse horário acabou de ser reservado, escolha outro.'
          using errcode = 'P0001';
      end;
      return v_id;
    end if;
  end loop;

  raise exception 'Esse horário acabou de ser reservado, escolha outro.' using errcode = 'P0001';
end;
$$;

revoke execute on function public.criar_pedido_online(uuid, uuid, timestamptz, text, text, text)
  from public, anon, authenticated;
grant execute on function public.criar_pedido_online(uuid, uuid, timestamptz, text, text, text)
  to service_role;

-- =============================================================================
-- 7. Aprovar e recusar (dona e recepção)
--
-- O pedido é travado (for update); não aguardando ou vencido → "Este pedido
-- já foi respondido." (duplo toque, duas recepcionistas, pedido de 24 h+).
-- Aprovar: trava a agenda de p_profissional (Ruling P3A-R2), marca aprovado
-- ANTES do insert (o gatilho agendamentos_pedido_online não vê o próprio
-- pedido como bloqueio), cria o agendamento confirmado de origem online e
-- liga o pedido a ele. Sobreposição de agenda → 23P01 de
-- agendamentos_sem_sobreposicao; tudo é desfeito e o pedido continua
-- aguardando.
-- =============================================================================
create function public.aprovar_pedido_online(
  p_pedido uuid,
  p_cliente uuid,
  p_profissional uuid,
  p_inicio timestamptz,
  p_fim timestamptz,
  p_valor_centavos int
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pedido public.pedidos_online;
  v_agendamento uuid;
begin
  if public.perfil_atual() is null or public.perfil_atual() not in ('dona', 'recepcao') then
    raise exception 'Apenas a dona ou a recepção podem responder pedidos' using errcode = 'P0001';
  end if;

  perform public.travar_agenda_profissional(p_profissional);

  select * into v_pedido from public.pedidos_online p where p.id = p_pedido for update;
  if not found or v_pedido.status <> 'aguardando' or public.pedido_vencido(v_pedido) then
    raise exception 'Este pedido já foi respondido.' using errcode = 'P0001';
  end if;

  update public.pedidos_online
  set status = 'aprovado',
      decidido_por = public.colaborador_atual_id(),
      decidido_em = now()
  where id = p_pedido;

  insert into public.agendamentos (
    cliente_id, profissional_id, servico_id, inicio, fim, status, origem,
    valor_previsto_centavos, criado_por
  ) values (
    p_cliente, p_profissional, v_pedido.servico_id, p_inicio, p_fim, 'confirmado', 'online',
    p_valor_centavos, public.colaborador_atual_id()
  )
  returning id into v_agendamento;

  update public.pedidos_online set agendamento_id = v_agendamento where id = p_pedido;

  return v_agendamento;
end;
$$;

revoke execute on function public.aprovar_pedido_online(uuid, uuid, uuid, timestamptz, timestamptz, int)
  from public, anon, authenticated;
grant execute on function public.aprovar_pedido_online(uuid, uuid, uuid, timestamptz, timestamptz, int)
  to authenticated;

create function public.recusar_pedido_online(p_pedido uuid, p_motivo text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pedido public.pedidos_online;
begin
  if public.perfil_atual() is null or public.perfil_atual() not in ('dona', 'recepcao') then
    raise exception 'Apenas a dona ou a recepção podem responder pedidos' using errcode = 'P0001';
  end if;

  select * into v_pedido from public.pedidos_online p where p.id = p_pedido for update;
  if not found or v_pedido.status <> 'aguardando' or public.pedido_vencido(v_pedido) then
    raise exception 'Este pedido já foi respondido.' using errcode = 'P0001';
  end if;

  update public.pedidos_online
  set status = 'recusado',
      motivo_recusa = nullif(btrim(p_motivo), ''),
      decidido_por = public.colaborador_atual_id(),
      decidido_em = now()
  where id = p_pedido;
end;
$$;

revoke execute on function public.recusar_pedido_online(uuid, text)
  from public, anon, authenticated;
grant execute on function public.recusar_pedido_online(uuid, text) to authenticated;
