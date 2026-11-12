-- =============================================================================
-- 0015_crm — Fase 5: CRM (retorno, clientes sumidas, leads)
--
--   1. Modelos retorno e reativação; leads (etapas, RLS, gatilho que protege
--      a conversão); listas crm_retornos e crm_sumidas; crm_indicadores (só a
--      dona); converter_lead.
--
-- Regras (spec 2026-11-12-fase-5-crm-design.md §2):
--   * Retorno: para cada par (cliente ativa, serviço com dias_retorno), o
--     agendamento 'atendido' mais recente; data_retorno = dia do início em
--     São Paulo + dias_retorno. Cliente com agendamento futuro (pendente ou
--     confirmado, início > agora) sai da lista.
--   * Sumida: cliente ativa cujo último 'atendido' (qualquer serviço) caiu
--     antes de hoje − dias_cliente_sumida (SP), sem agendamento futuro. Quem
--     nunca foi atendida não entra.
--   * Leads não são apagados; cliente_id/convertido_em só mudam por
--     converter_lead.
--
-- Dependências: 0001_base, 0002_agenda, 0012_whatsapp, 0014_crm_tipos (valores
-- 'retorno' e 'reativacao' de tipo_mensagem, já confirmados).
-- =============================================================================

-- =============================================================================
-- 1. Modelos, leads, listas, indicadores e conversão
-- =============================================================================

insert into public.modelos_mensagem (tipo, variacoes) values
  ('retorno', array['Oi, {nome}! Já está na hora de renovar seu {servico}. Quer que a gente reserve um horário para você? {clinica}']),
  ('reativacao', array['Oi, {nome}! Sentimos sua falta aqui na {clinica}. Que tal agendar um momento para você? É só responder esta mensagem.']);

create type public.etapa_lead as enum (
  'novo', 'em_conversa', 'orcamento_enviado', 'agendou', 'perdido'
);

create table public.leads (
  id uuid primary key default gen_random_uuid(),
  nome text not null check (char_length(btrim(nome)) between 1 and 120),
  whatsapp text check (whatsapp ~ '^55\d{10,11}$'),
  -- Serviço de interesse.
  servico_id uuid references public.servicos (id),
  origem text check (origem in ('instagram', 'indicacao', 'google', 'passou_na_frente', 'outro')),
  etapa public.etapa_lead not null default 'novo',
  -- Só com etapa 'perdido' (o gatilho limpa ao sair).
  perdido_motivo text check (char_length(perdido_motivo) <= 200),
  responsavel_id uuid references public.colaboradores (id),
  observacoes text check (char_length(observacoes) <= 2000),
  cliente_id uuid references public.clientes (id),
  convertido_em timestamptz,
  criado_por uuid references public.colaboradores (id) default public.colaborador_atual_id(),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  constraint leads_perdido_motivo_etapa_check check (perdido_motivo is null or etapa = 'perdido'),
  constraint leads_conversao_check check ((cliente_id is null) = (convertido_em is null))
);

create index leads_etapa_idx on public.leads (etapa);
create index leads_cliente_idx on public.leads (cliente_id);
create index leads_whatsapp_idx on public.leads (whatsapp);
create index leads_servico_idx on public.leads (servico_id);
create index leads_responsavel_idx on public.leads (responsavel_id);
create index leads_criado_por_idx on public.leads (criado_por);

create trigger leads_atualizado_em before update on public.leads
  for each row execute function public.set_atualizado_em();

-- cliente_id/convertido_em: nunca no insert; no update só dentro de
-- converter_lead (marcador de transação app.convertendo_lead = '1') e só se o
-- lead ainda não foi convertido. Motivo da perda vazio vira nulo e é limpo
-- quando a etapa não é 'perdido'.
create function public.leads_proteger()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.cliente_id is not null or new.convertido_em is not null then
      raise exception 'Para ligar o lead a uma cliente, use Converter em cliente.'
        using errcode = 'P0001';
    end if;
  elsif new.cliente_id is distinct from old.cliente_id
        or new.convertido_em is distinct from old.convertido_em then
    if old.cliente_id is not null then
      raise exception 'Este lead já virou cliente.' using errcode = 'P0001';
    elsif coalesce(current_setting('app.convertendo_lead', true), '') <> '1' then
      raise exception 'Para ligar o lead a uma cliente, use Converter em cliente.'
        using errcode = 'P0001';
    end if;
  end if;

  new.perdido_motivo := nullif(btrim(new.perdido_motivo), '');
  if new.etapa <> 'perdido' then
    new.perdido_motivo := null;
  end if;
  return new;
end;
$$;

revoke execute on function public.leads_proteger() from public, anon, authenticated;

create trigger leads_proteger before insert or update on public.leads
  for each row execute function public.leads_proteger();

-- RLS: dona e recepção leem, criam e alteram; profissional e anon nada;
-- ninguém apaga. Colunas de conversão e autoria fora dos grants de escrita.
alter table public.leads enable row level security;

revoke all on public.leads from anon, authenticated;
revoke delete, truncate on public.leads from service_role;
grant select on public.leads to authenticated;
grant insert (nome, whatsapp, servico_id, origem, etapa, perdido_motivo, responsavel_id, observacoes)
  on public.leads to authenticated;
grant update (nome, whatsapp, servico_id, origem, etapa, perdido_motivo, responsavel_id, observacoes)
  on public.leads to authenticated;

create policy leads_select on public.leads
  for select to authenticated
  using ((select public.perfil_atual()) in ('dona', 'recepcao'));
create policy leads_insert on public.leads
  for insert to authenticated
  with check ((select public.perfil_atual()) in ('dona', 'recepcao'));
create policy leads_update on public.leads
  for update to authenticated
  using ((select public.perfil_atual()) in ('dona', 'recepcao'))
  with check ((select public.perfil_atual()) in ('dona', 'recepcao'));

-- Dona ou recepção; senão P0001.
create function public.exigir_equipe_crm()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if public.perfil_atual() is null or public.perfil_atual() not in ('dona', 'recepcao') then
    raise exception 'Apenas a dona ou a recepção podem usar o CRM.' using errcode = 'P0001';
  end if;
end;
$$;

revoke execute on function public.exigir_equipe_crm()
  from public, anon, authenticated, service_role;

-- Agendamento futuro = pendente ou confirmado com início depois de agora.
create function public.cliente_tem_agendamento_futuro(p_cliente uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.agendamentos a
    where a.cliente_id = p_cliente
      and a.status in ('pendente', 'confirmado')
      and a.inicio > now()
  )
$$;

revoke execute on function public.cliente_tem_agendamento_futuro(uuid)
  from public, anon, authenticated, service_role;

-- Origens de retorno (interna): para cada (cliente ativa, serviço com
-- dias_retorno), o 'atendido' mais recente, com a data do retorno; sem as
-- clientes com agendamento futuro.
create function public.crm_origens_retorno()
returns table (
  agendamento_id uuid,
  cliente_id uuid,
  servico_id uuid,
  inicio timestamptz,
  data_retorno date
)
language sql
stable
security definer
set search_path = ''
as $$
  select o.id, o.cliente_id, o.servico_id, o.inicio,
         (o.inicio at time zone 'America/Sao_Paulo')::date + s.dias_retorno
  from (
    select distinct on (a.cliente_id, a.servico_id) a.id, a.cliente_id, a.servico_id, a.inicio
    from public.agendamentos a
    where a.status = 'atendido'
    order by a.cliente_id, a.servico_id, a.inicio desc, a.id desc
  ) o
  join public.servicos s on s.id = o.servico_id
  join public.clientes c on c.id = o.cliente_id
  where s.dias_retorno is not null
    and c.ativo
    and not public.cliente_tem_agendamento_futuro(o.cliente_id)
$$;

revoke execute on function public.crm_origens_retorno()
  from public, anon, authenticated, service_role;

-- Lista de retorno até p_ate (inclui os atrasados). retorno_enviado_em: o
-- retorno dessa origem que não foi cancelado nem falhou — enviada_em, ou
-- agendado_para se ainda não saiu.
create function public.crm_retornos(p_ate date)
returns table (
  cliente_id uuid,
  cliente_nome text,
  whatsapp text,
  aceita_marketing boolean,
  servico_id uuid,
  servico_nome text,
  agendamento_id uuid,
  ultimo_atendimento timestamptz,
  data_retorno date,
  retorno_enviado_em timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.exigir_equipe_crm();

  return query
  select c.id, c.nome, c.whatsapp, c.aceita_whatsapp_marketing, s.id, s.nome,
         o.agendamento_id, o.inicio, o.data_retorno,
         (
           select coalesce(f.enviada_em, f.agendado_para)
           from public.fila_mensagens f
           where f.agendamento_id = o.agendamento_id
             and f.tipo = 'retorno'
             and f.status not in ('cancelada', 'falhou')
           order by f.criado_em desc
           limit 1
         )
  from public.crm_origens_retorno() o
  join public.clientes c on c.id = o.cliente_id
  join public.servicos s on s.id = o.servico_id
  where o.data_retorno <= p_ate
  order by o.data_retorno, c.nome, s.nome, o.agendamento_id;
end;
$$;

revoke execute on function public.crm_retornos(date) from public, anon, authenticated;
grant execute on function public.crm_retornos(date) to authenticated;

-- Clientes sumidas. dias_sem_vir conta em dias de São Paulo.
-- reativacao_enviada_em: a reativação mais recente que não foi cancelada nem
-- falhou (enviada_em, ou agendado_para se ainda não saiu).
create function public.crm_sumidas()
returns table (
  cliente_id uuid,
  nome text,
  whatsapp text,
  aceita_marketing boolean,
  ultimo_atendimento timestamptz,
  dias_sem_vir int,
  reativacao_enviada_em timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_dias int;
begin
  perform public.exigir_equipe_crm();

  v_dias := coalesce((select cc.dias_cliente_sumida from public.configuracoes_clinica cc limit 1), 90);

  return query
  select c.id, c.nome, c.whatsapp, c.aceita_whatsapp_marketing, u.ultimo,
         (v_hoje - (u.ultimo at time zone 'America/Sao_Paulo')::date)::int,
         (
           select max(coalesce(f.enviada_em, f.agendado_para))
           from public.fila_mensagens f
           where f.cliente_id = c.id
             and f.tipo = 'reativacao'
             and f.status not in ('cancelada', 'falhou')
         )
  from public.clientes c
  join lateral (
    select max(a.inicio) as ultimo
    from public.agendamentos a
    where a.cliente_id = c.id and a.status = 'atendido'
  ) u on u.ultimo is not null
  where c.ativo
    and (u.ultimo at time zone 'America/Sao_Paulo')::date < v_hoje - v_dias
    and not public.cliente_tem_agendamento_futuro(c.id)
  order by u.ultimo, c.nome, c.id;
end;
$$;

revoke execute on function public.crm_sumidas() from public, anon, authenticated;
grant execute on function public.crm_sumidas() to authenticated;

-- Indicadores do Início (só a dona): retornos até hoje + 7 (inclui
-- atrasados), sumidas, leads em aberto e convertidos no mês corrente (SP).
create function public.crm_indicadores()
returns table (retornos int, sumidas int, leads_abertos int, convertidos_mes int)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  if public.perfil_atual() is distinct from 'dona' then
    raise exception 'Apenas a dona vê os indicadores.' using errcode = 'P0001';
  end if;

  return query
  select
    (select count(*)::int from public.crm_retornos(v_hoje + 7)),
    (select count(*)::int from public.crm_sumidas()),
    (select count(*)::int from public.leads l
     where l.etapa in ('novo', 'em_conversa', 'orcamento_enviado')),
    (select count(*)::int from public.leads l
     where l.convertido_em is not null
       and date_trunc('month', l.convertido_em at time zone 'America/Sao_Paulo')
           = date_trunc('month', now() at time zone 'America/Sao_Paulo'));
end;
$$;

revoke execute on function public.crm_indicadores() from public, anon, authenticated;
grant execute on function public.crm_indicadores() to authenticated;

-- Converte o lead em cliente: liga à cliente com o mesmo WhatsApp (ativa
-- primeiro, depois a mais antiga) ou cria uma (nome, WhatsApp, origem, aceite
-- LGPD agora, opt-in conforme p_aceita_marketing). Cliente existente não é
-- alterada. A etapa do lead não muda. Devolve o id da cliente.
create function public.converter_lead(p_lead uuid, p_aceite_lgpd boolean, p_aceita_marketing boolean)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lead public.leads;
  v_cliente uuid;
begin
  perform public.exigir_equipe_crm();

  select * into v_lead from public.leads l where l.id = p_lead for update;
  if not found then
    raise exception 'Lead não encontrado.' using errcode = 'P0001';
  elsif v_lead.cliente_id is not null then
    raise exception 'Este lead já virou cliente.' using errcode = 'P0001';
  end if;

  if not coalesce(p_aceite_lgpd, false) then
    raise exception 'Confirme o aceite da LGPD.' using errcode = 'P0001';
  end if;

  if v_lead.whatsapp is not null then
    select c.id into v_cliente
    from public.clientes c
    where c.whatsapp = v_lead.whatsapp
    order by c.ativo desc, c.criado_em, c.id
    limit 1;
  end if;

  if v_cliente is null then
    insert into public.clientes (nome, whatsapp, origem, aceite_lgpd_em, aceita_whatsapp_marketing)
    values (btrim(v_lead.nome), v_lead.whatsapp, v_lead.origem, now(), coalesce(p_aceita_marketing, false))
    returning id into v_cliente;
  end if;

  perform set_config('app.convertendo_lead', '1', true);
  update public.leads l set cliente_id = v_cliente, convertido_em = now() where l.id = p_lead;
  perform set_config('app.convertendo_lead', '', true);

  return v_cliente;
end;
$$;

revoke execute on function public.converter_lead(uuid, boolean, boolean) from public, anon, authenticated;
grant execute on function public.converter_lead(uuid, boolean, boolean) to authenticated;
