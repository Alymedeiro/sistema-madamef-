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
--   5–7. Funções públicas e de aprovação (Task 2).
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
