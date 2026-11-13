-- =============================================================================
-- 0019_notificacoes — notificações em tempo real (etapa 1: sistema aberto).
--
--   1. notificacoes: uma linha por destinatário (colaborador ATIVO), escrita só
--      pelos gatilhos desta migração. RLS: cada colaborador lê e marca como
--      lidas (lida_em) só as próprias; ninguém insere nem apaga direto.
--      marcar_notificacoes_lidas(p_ids) (null = todas do usuário).
--   2. Gatilhos (security definer; NUNCA falham o comando original: qualquer
--      erro vira WARNING):
--        mensagens_recebidas insert   → mensagem_recebida (dona, recepção) ou,
--          com classificação confirmou/quer_remarcar e agendamento, esse tipo
--          (dona, recepção e a profissional do agendamento) — uma por mensagem.
--          mensagens_recebidas só guarda o que CHEGOU: o que o robô e a equipe
--          enviam fica em fila_mensagens e não gera "mensagem_recebida".
--        pedidos_online insert (aguardando) → pedido_online (dona, recepção)
--        robo_sessoes pediu_equipe_em passa a ter valor (ou muda) → pediu_equipe
--        agendamentos insert (não cancelado, ainda não terminado) ou update
--          para cancelado → agenda_profissional (só a profissional dele, e não
--          quando foi ela mesma quem agendou/cancelou)
--        fila_mensagens status → falhou → mensagem_falhou (dona, recepção)
--      Textos curtos, sem dados de saúde (nome da cliente pelo primeiro nome,
--      serviço, data/hora em America/Sao_Paulo). Links internos: conversa
--      (/mensagens?conversa=<chave>, a mesma chave de agruparConversas em
--      src/app/(app)/mensagens/dados.ts: cliente_id, ou o telefone normalizado
--      por chaveTelefone), /agenda?data=YYYY-MM-DD e /agenda/pedidos?pedido=.
--   3. preferencias_notificacao (som, volume, desktop, tipos): RLS só o
--      próprio; escrita por salvar_preferencias_notificacao (upsert).
--   4. Limpeza diária (pg_cron, bloco tolerante como 0012): apaga notificações
--      com mais de 30 dias. Exceção aceita à regra "nada é apagado": a
--      notificação é um aviso efêmero; o fato em si continua na tabela de
--      origem (mensagem, pedido, agendamento, fila).
--   5. Realtime: notificacoes entra na publicação supabase_realtime (só se a
--      publicação existir — no Postgres local dos testes não existe).
--
-- Dependências: 0001_base (colaboradores, clientes, servicos,
-- colaborador_atual_id), 0002_agenda (agendamentos), 0009 (pedidos_online),
-- 0012 (mensagens_recebidas, fila_mensagens), 0017 (robo_sessoes).
-- =============================================================================

set lock_timeout = '5s';

-- =============================================================================
-- 1. Tabela, RLS e marcar como lidas
-- =============================================================================

create table public.notificacoes (
  id uuid primary key default gen_random_uuid(),
  colaborador_id uuid not null references public.colaboradores (id) on delete cascade,
  tipo text not null check (tipo in (
    'mensagem_recebida', 'pedido_online', 'confirmou', 'quer_remarcar',
    'pediu_equipe', 'agenda_profissional', 'mensagem_falhou'
  )),
  titulo text not null check (char_length(titulo) between 1 and 120),
  corpo text check (char_length(corpo) <= 300),
  -- Rota interna: começa com "/" (e não "//", que seria outro site).
  link text not null default '/inicio'
    check (char_length(link) <= 300 and link ~ '^/' and link !~ '^//'),
  criada_em timestamptz not null default now(),
  lida_em timestamptz
);

create index notificacoes_colaborador_criada_idx
  on public.notificacoes (colaborador_id, criada_em desc);
create index notificacoes_nao_lidas_idx
  on public.notificacoes (colaborador_id, criada_em desc) where lida_em is null;

alter table public.notificacoes enable row level security;

revoke all on public.notificacoes from anon, authenticated;
revoke insert, update, delete, truncate on public.notificacoes from service_role;
grant select on public.notificacoes to authenticated;
grant update (lida_em) on public.notificacoes to authenticated;

create policy notificacoes_select on public.notificacoes
  for select to authenticated
  using (colaborador_id = (select public.colaborador_atual_id()));
create policy notificacoes_update on public.notificacoes
  for update to authenticated
  using (colaborador_id = (select public.colaborador_atual_id()))
  with check (colaborador_id = (select public.colaborador_atual_id()));

-- Sem colaborador ativo → P0001.
create function public.exigir_colaborador_notificacoes()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_id uuid := public.colaborador_atual_id();
begin
  if v_id is null then
    raise exception 'Entre no sistema para ver as notificações.' using errcode = 'P0001';
  end if;
  return v_id;
end;
$$;

revoke execute on function public.exigir_colaborador_notificacoes()
  from public, anon, authenticated, service_role;

-- Marca como lidas as notificações do usuário: as de p_ids, ou todas (null).
-- Ids de outra pessoa são ignorados. Devolve quantas mudaram.
create function public.marcar_notificacoes_lidas(p_ids uuid[] default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_eu uuid := public.exigir_colaborador_notificacoes();
  v_n integer;
begin
  update public.notificacoes n
  set lida_em = now()
  where n.colaborador_id = v_eu
    and n.lida_em is null
    and (p_ids is null or n.id = any (p_ids));
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke execute on function public.marcar_notificacoes_lidas(uuid[]) from public, anon;
grant execute on function public.marcar_notificacoes_lidas(uuid[]) to authenticated;

-- =============================================================================
-- 2. Montagem dos textos e gatilhos
-- =============================================================================

-- Chave da conversa (= agruparConversas): cliente_id; senão o telefone com o 9
-- depois do DDD (chaveTelefone).
create function public.notificacao_chave_conversa(p_cliente uuid, p_telefone text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_cliente is not null then p_cliente::text
    when p_telefone ~ '^55\d{10}$' then left(p_telefone, 4) || '9' || substr(p_telefone, 5)
    else p_telefone
  end
$$;

-- Link da conversa; chave fora do padrão (uuid ou dígitos) → /mensagens.
create function public.notificacao_link_conversa(p_cliente uuid, p_telefone text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when public.notificacao_chave_conversa(p_cliente, p_telefone) ~ '^[0-9a-f-]{1,64}$'
      then '/mensagens?conversa=' || public.notificacao_chave_conversa(p_cliente, p_telefone)
    else '/mensagens'
  end
$$;

-- Como chamar a pessoa: primeiro nome da cliente; sem cadastro, o telefone
-- formatado ("(21) 98888-7777").
create function public.notificacao_nome(p_cliente uuid, p_telefone text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select nullif(split_part(btrim(c.nome), ' ', 1), '')
     from public.clientes c where c.id = p_cliente),
    case
      when p_telefone ~ '^55\d{10,11}$' then
        '(' || substr(p_telefone, 3, 2) || ') '
          || substr(p_telefone, 5, char_length(p_telefone) - 8) || '-' || right(p_telefone, 4)
      else nullif(left(btrim(coalesce(p_telefone, '')), 40), '')
    end,
    'Contato sem nome'
  )
$$;

-- "14/11 às 15:00" (São Paulo).
create function public.notificacao_quando(p_inicio timestamptz)
returns text
language sql
stable
set search_path = ''
as $$
  select to_char(p_inicio at time zone 'America/Sao_Paulo', 'DD/MM "às" HH24:MI')
$$;

create function public.notificacao_link_agenda(p_inicio timestamptz)
returns text
language sql
stable
set search_path = ''
as $$
  select '/agenda?data=' || to_char(p_inicio at time zone 'America/Sao_Paulo', 'YYYY-MM-DD')
$$;

-- Insere uma linha por destinatário ATIVO: dona e recepção (p_equipe) e/ou
-- p_profissional (que recebe p_link_profissional, se informado, a menos que
-- também seja da equipe). Cada colaborador recebe uma linha só.
create function public.notificar(
  p_tipo text,
  p_titulo text,
  p_corpo text,
  p_link text,
  p_equipe boolean,
  p_profissional uuid default null,
  p_link_profissional text default null
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.notificacoes (colaborador_id, tipo, titulo, corpo, link)
  select c.id, p_tipo, left(p_titulo, 120), left(p_corpo, 300),
    case
      when p_equipe and c.perfil in ('dona', 'recepcao') then p_link
      else coalesce(p_link_profissional, p_link)
    end
  from public.colaboradores c
  where c.ativo
    and ((p_equipe and c.perfil in ('dona', 'recepcao')) or c.id = p_profissional);
$$;

revoke execute on function public.notificacao_nome(uuid, text) from public, anon, authenticated;
revoke execute on function public.notificacao_chave_conversa(uuid, text)
  from public, anon, authenticated;
revoke execute on function public.notificacao_link_conversa(uuid, text)
  from public, anon, authenticated;
revoke execute on function public.notificacao_quando(timestamptz) from public, anon, authenticated;
revoke execute on function public.notificacao_link_agenda(timestamptz)
  from public, anon, authenticated;
revoke execute on function public.notificar(text, text, text, text, boolean, uuid, text)
  from public, anon, authenticated, service_role;

-- Mensagem que chegou. confirmou/quer_remarcar com agendamento vira esse tipo
-- (com a profissional); o resto, mensagem_recebida (dona e recepção).
create function public.notificar_mensagem_recebida()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_nome text;
  v_ag record;
  v_conversa text;
begin
  begin
    v_nome := public.notificacao_nome(new.cliente_id, new.telefone);
    v_conversa := public.notificacao_link_conversa(new.cliente_id, new.telefone);

    if new.classificacao in ('confirmou', 'quer_remarcar') and new.agendamento_id is not null then
      select a.inicio, a.profissional_id, s.nome as servico, p.nome as profissional
        into v_ag
      from public.agendamentos a
      join public.servicos s on s.id = a.servico_id
      join public.colaboradores p on p.id = a.profissional_id
      where a.id = new.agendamento_id;

      if found then
        perform public.notificar(
          new.classificacao,
          v_nome || case when new.classificacao = 'confirmou'
                      then ' confirmou o horário de ' else ' quer remarcar o horário de ' end
            || public.notificacao_quando(v_ag.inicio),
          v_ag.servico || ' com ' || v_ag.profissional,
          case when new.classificacao = 'confirmou'
            then public.notificacao_link_agenda(v_ag.inicio) else v_conversa end,
          true,
          v_ag.profissional_id,
          public.notificacao_link_agenda(v_ag.inicio)
        );
        return null;
      end if;
    end if;

    -- Dígito ou "menu" respondido pelo robô (atendendo agora e sem pausa na
    -- conversa): é navegação no menu, não precisa avisar a equipe.
    if lower(translate(
         btrim(new.texto),
         'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
         'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC'
       )) ~ '^([0-8]\.?|menu)$'
       and public.robo_atende_agora()
       and not exists (
         select 1 from public.robo_sessoes rs
         where rs.telefone = any (public.robo_telefones(new.telefone))
           and rs.pausado_ate > now()
       ) then
      return null;
    end if;

    perform public.notificar(
      'mensagem_recebida',
      'Nova mensagem de ' || v_nome,
      nullif(left(btrim(new.texto), 80), ''),
      v_conversa,
      true
    );
  exception when others then
    raise warning 'Notificações: não foi possível avisar da mensagem %: %', new.id, sqlerrm;
  end;
  return null;
end;
$$;

create trigger mensagens_recebidas_notificar
  after insert on public.mensagens_recebidas
  for each row execute function public.notificar_mensagem_recebida();

-- Pedido online novo (aguardando).
create function public.notificar_pedido_online()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_servico text;
begin
  begin
    if new.status <> 'aguardando' then
      return null;
    end if;
    select s.nome into v_servico from public.servicos s where s.id = new.servico_id;
    perform public.notificar(
      'pedido_online',
      'Novo pedido online — ' || coalesce(v_servico, 'serviço') || ', '
        || public.notificacao_quando(new.inicio),
      'Pedido de ' || coalesce(nullif(split_part(btrim(new.nome), ' ', 1), ''), 'cliente')
        || '. Aprove ou recuse na agenda.',
      '/agenda/pedidos?pedido=' || new.id::text,
      true
    );
  exception when others then
    raise warning 'Notificações: não foi possível avisar do pedido %: %', new.id, sqlerrm;
  end;
  return null;
end;
$$;

create trigger pedidos_online_notificar
  after insert on public.pedidos_online
  for each row execute function public.notificar_pedido_online();

-- Cliente pediu para falar com a equipe (robô).
create function public.notificar_pediu_equipe()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    if new.pediu_equipe_em is null
       or (tg_op = 'UPDATE' and new.pediu_equipe_em is not distinct from old.pediu_equipe_em) then
      return null;
    end if;
    perform public.notificar(
      'pediu_equipe',
      public.notificacao_nome(new.cliente_id, new.telefone) || ' pediu para falar com a equipe',
      'O robô fica pausado nesta conversa por 24 h.',
      public.notificacao_link_conversa(new.cliente_id, new.telefone),
      true
    );
  exception when others then
    raise warning 'Notificações: não foi possível avisar do pedido de atendimento de %: %',
      new.telefone, sqlerrm;
  end;
  return null;
end;
$$;

create trigger robo_sessoes_notificar
  after insert or update of pediu_equipe_em on public.robo_sessoes
  for each row execute function public.notificar_pediu_equipe();

-- Agenda da profissional: agendamento novo (não cancelado e ainda não
-- terminado) ou cancelado. Quem fez a mudança não é avisada de si mesma.
create function public.notificar_agenda_profissional()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_titulo text;
begin
  begin
    if new.profissional_id is not distinct from public.colaborador_atual_id() then
      return null;
    end if;
    if tg_op = 'INSERT' then
      if new.status = 'cancelado' or new.fim <= now() then
        return null;
      end if;
      v_titulo := 'Novo agendamento — ';
    elsif new.status = 'cancelado' and old.status is distinct from 'cancelado' then
      v_titulo := 'Agendamento cancelado — ';
    else
      return null;
    end if;

    perform public.notificar(
      'agenda_profissional',
      v_titulo || public.notificacao_quando(new.inicio),
      public.notificacao_nome(new.cliente_id, null) || ' · '
        || coalesce((select s.nome from public.servicos s where s.id = new.servico_id), 'serviço'),
      public.notificacao_link_agenda(new.inicio),
      false,
      new.profissional_id
    );
  exception when others then
    raise warning 'Notificações: não foi possível avisar a profissional do agendamento %: %',
      new.id, sqlerrm;
  end;
  return null;
end;
$$;

create trigger agendamentos_notificar
  after insert or update of status on public.agendamentos
  for each row execute function public.notificar_agenda_profissional();

-- Mensagem que não saiu (status → falhou).
create function public.notificar_mensagem_falhou()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    if new.status <> 'falhou' or old.status = 'falhou' then
      return null;
    end if;
    perform public.notificar(
      'mensagem_falhou',
      'Mensagem não enviada para ' || public.notificacao_nome(new.cliente_id, new.telefone),
      'Veja a conversa e tente reenviar.',
      public.notificacao_link_conversa(new.cliente_id, new.telefone),
      true
    );
  exception when others then
    raise warning 'Notificações: não foi possível avisar da falha da mensagem %: %',
      new.id, sqlerrm;
  end;
  return null;
end;
$$;

create trigger fila_mensagens_notificar
  after update of status on public.fila_mensagens
  for each row execute function public.notificar_mensagem_falhou();

revoke execute on function public.notificar_mensagem_recebida() from public, anon, authenticated;
revoke execute on function public.notificar_pedido_online() from public, anon, authenticated;
revoke execute on function public.notificar_pediu_equipe() from public, anon, authenticated;
revoke execute on function public.notificar_agenda_profissional() from public, anon, authenticated;
revoke execute on function public.notificar_mensagem_falhou() from public, anon, authenticated;

-- =============================================================================
-- 3. Preferências
-- =============================================================================

create table public.preferencias_notificacao (
  colaborador_id uuid primary key references public.colaboradores (id) on delete cascade,
  som boolean not null default true,
  volume int not null default 40 check (volume between 0 and 100),
  desktop boolean not null default true,
  tipos text[] not null default array[
    'mensagem_recebida', 'pedido_online', 'confirmou', 'quer_remarcar',
    'pediu_equipe', 'agenda_profissional', 'mensagem_falhou'
  ]::text[]
    check (tipos <@ array[
      'mensagem_recebida', 'pedido_online', 'confirmou', 'quer_remarcar',
      'pediu_equipe', 'agenda_profissional', 'mensagem_falhou'
    ]::text[] and array_position(tipos, null) is null),
  atualizado_em timestamptz not null default now()
);

create trigger preferencias_notificacao_atualizado_em
  before update on public.preferencias_notificacao
  for each row execute function public.set_atualizado_em();

alter table public.preferencias_notificacao enable row level security;

revoke all on public.preferencias_notificacao from anon, authenticated;
revoke insert, update, delete, truncate on public.preferencias_notificacao from service_role;
grant select on public.preferencias_notificacao to authenticated;

create policy preferencias_notificacao_select on public.preferencias_notificacao
  for select to authenticated
  using (colaborador_id = (select public.colaborador_atual_id()));

-- Grava (upsert) as preferências do usuário. p_tipos null = todos os tipos;
-- repetidos são removidos. Volume fora de 0–100 ou tipo inválido → P0001.
create function public.salvar_preferencias_notificacao(
  p_som boolean,
  p_volume integer,
  p_desktop boolean,
  p_tipos text[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_eu uuid := public.exigir_colaborador_notificacoes();
  v_todos constant text[] := array[
    'mensagem_recebida', 'pedido_online', 'confirmou', 'quer_remarcar',
    'pediu_equipe', 'agenda_profissional', 'mensagem_falhou'
  ];
  v_tipos text[];
begin
  if p_volume is null or p_volume not between 0 and 100 then
    raise exception 'O volume vai de 0 a 100.' using errcode = 'P0001';
  end if;
  if p_tipos is not null and not (p_tipos <@ v_todos and array_position(p_tipos, null) is null) then
    raise exception 'Tipo de notificação inválido.' using errcode = 'P0001';
  end if;

  select coalesce(array_agg(distinct t order by t), '{}') into v_tipos
  from unnest(coalesce(p_tipos, v_todos)) as t;
  if p_tipos is null then
    v_tipos := v_todos;
  end if;

  insert into public.preferencias_notificacao as p (colaborador_id, som, volume, desktop, tipos)
  values (v_eu, coalesce(p_som, true), p_volume, coalesce(p_desktop, true), v_tipos)
  on conflict (colaborador_id) do update
    set som = excluded.som, volume = excluded.volume,
        desktop = excluded.desktop, tipos = excluded.tipos;
end;
$$;

revoke execute on function public.salvar_preferencias_notificacao(boolean, integer, boolean, text[])
  from public, anon;
grant execute on function public.salvar_preferencias_notificacao(boolean, integer, boolean, text[])
  to authenticated;

-- =============================================================================
-- 4. Limpeza (30 dias) e jobs
-- =============================================================================

create function public.limpar_notificacoes_antigas()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  delete from public.notificacoes n where n.criada_em < now() - interval '30 days';
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke execute on function public.limpar_notificacoes_antigas()
  from public, anon, authenticated, service_role;

--   notificacoes_limpeza 41 6 * * *  limpar_notificacoes_antigas() (03:41 SP)
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    begin
      create extension if not exists pg_cron with schema pg_catalog;
      perform cron.schedule(
        'notificacoes_limpeza',
        '41 6 * * *',
        $cron$select public.limpar_notificacoes_antigas();$cron$
      );
    exception when others then
      raise notice 'pg_cron indisponível; agende notificacoes_limpeza à mão: %', sqlerrm;
    end;
  end if;
end
$$;

-- =============================================================================
-- 5. Realtime
-- =============================================================================

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      if not exists (
        select 1 from pg_publication p
        where p.pubname = 'supabase_realtime'
          and (p.puballtables or exists (
            select 1 from pg_publication_tables t
            where t.pubname = p.pubname and t.schemaname = 'public' and t.tablename = 'notificacoes'
          ))
      ) then
        alter publication supabase_realtime add table public.notificacoes;
      end if;
    exception when others then
      raise notice 'Não foi possível pôr notificacoes no Realtime; adicione à mão: %', sqlerrm;
    end;
  else
    raise notice 'Publicação supabase_realtime ausente; notificacoes fica fora do Realtime.';
  end if;
end
$$;
