-- =============================================================================
-- 0006 — Ficha clínica, auditoria e armazenamento (Fase 2, Task 1)
--
--   1. Modelos versionados de anamnese e de termo (só uma versão ativa).
--   2. Tabelas clínicas: anamneses, termos_assinados, fotos, evolucoes.
--      Nada é apagado: sem privilégio de delete; correção = nova versão ou
--      arquivamento (fotos).
--   3. acesso_clinico(cliente, área): regra única de quem vê cada parte da
--      ficha, usada pelas políticas das tabelas, do Storage e por
--      registrar_acesso.
--   4. auditoria: gatilho em toda escrita clínica + registrar_acesso em toda
--      leitura (feita no servidor). Só a dona lê.
--   5. Bucket privado `ficha-clinica` e políticas em storage.objects. (No
--      Supabase real o RLS de storage.objects já está ligado; esta migração só
--      cria o bucket e as políticas.)
--   6. Pendências: termo pendente por atendimento, alerta da anamnese.
--   7. Ajustes herdados da Fase 1 (spec §7).
--
-- Dependências: 0001_base (perfil_atual, colaborador_atual_id,
-- cliente_vinculada, set_atualizado_em, clientes, colaboradores, servicos),
-- 0002_agenda (agendamentos), 0003_caixa (caixas, pagamentos),
-- 0004_clientes_busca (normalizar_busca).
-- =============================================================================

-- Tipos ----------------------------------------------------------------------
create type public.tipo_foto as enum ('antes', 'depois', 'evolucao');
create type public.acao_auditoria as enum ('visualizou', 'criou', 'alterou', 'arquivou');

-- =============================================================================
-- 1. Modelos
-- =============================================================================

-- perguntas: [{ id, tipo: texto|sim_nao|sim_nao_detalhe|multipla|data, texto,
--              obrigatoria, alerta, opcoes? }]
create table public.modelos_anamnese (
  id uuid primary key default gen_random_uuid(),
  titulo text not null check (length(trim(titulo)) > 0),
  versao int not null unique check (versao >= 1),
  perguntas jsonb not null
    check (jsonb_typeof(perguntas) = 'array' and jsonb_array_length(perguntas) > 0),
  ativo boolean not null default false,
  criado_por uuid references public.colaboradores (id)
    default public.colaborador_atual_id(),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
-- Uma única versão ativa.
create unique index modelos_anamnese_um_ativo on public.modelos_anamnese ((true)) where ativo;
create index modelos_anamnese_criado_por_idx on public.modelos_anamnese (criado_por);

-- Cada termo é um grupo de versões (grupo_id); uma versão ativa por grupo.
create table public.modelos_termo (
  id uuid primary key default gen_random_uuid(),
  grupo_id uuid not null default gen_random_uuid(),
  titulo text not null check (length(trim(titulo)) > 0),
  -- Markdown simples (# título de seção, parágrafos).
  texto text not null check (length(trim(texto)) > 0),
  versao int not null check (versao >= 1),
  ativo boolean not null default false,
  criado_por uuid references public.colaboradores (id)
    default public.colaborador_atual_id(),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  constraint modelos_termo_grupo_versao_key unique (grupo_id, versao)
);
create unique index modelos_termo_um_ativo_por_grupo
  on public.modelos_termo (grupo_id) where ativo;
create index modelos_termo_criado_por_idx on public.modelos_termo (criado_por);

alter table public.servicos
  add constraint servicos_modelo_termo_id_fkey
  foreign key (modelo_termo_id) references public.modelos_termo (id);
create index servicos_modelo_termo_idx on public.servicos (modelo_termo_id);

-- =============================================================================
-- 2. Tabelas clínicas
--
-- Toda coluna de caminho fica amarrada à própria cliente e à pasta certa:
-- clientes/<cliente_id>/{anamneses|termos|fotos}/<uuid>.<png|pdf|jpg>.
-- =============================================================================

create table public.anamneses (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references public.clientes (id),
  modelo_id uuid not null references public.modelos_anamnese (id),
  modelo_versao int not null,
  -- { [perguntaId]: valor }
  respostas jsonb not null check (jsonb_typeof(respostas) = 'object'),
  assinatura_path text not null
    check (assinatura_path ~ ('^clientes/' || cliente_id::text || '/anamneses/[0-9a-f-]{36}\.png$')),
  preenchida_por uuid not null references public.colaboradores (id)
    default public.colaborador_atual_id(),
  preenchida_em timestamptz not null default now(),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index anamneses_cliente_preenchida_idx on public.anamneses (cliente_id, preenchida_em desc);
create index anamneses_modelo_idx on public.anamneses (modelo_id);
create index anamneses_preenchida_por_idx on public.anamneses (preenchida_por);

create table public.termos_assinados (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references public.clientes (id),
  modelo_termo_id uuid not null references public.modelos_termo (id),
  modelo_versao int not null,
  agendamento_id uuid references public.agendamentos (id),
  assinatura_path text not null
    check (assinatura_path ~ ('^clientes/' || cliente_id::text || '/termos/[0-9a-f-]{36}\.png$')),
  pdf_path text not null
    check (pdf_path ~ ('^clientes/' || cliente_id::text || '/termos/[0-9a-f-]{36}\.pdf$')),
  -- SHA-256 do PDF gravado (comprova que o arquivo não mudou).
  hash_sha256 text not null check (hash_sha256 ~ '^[0-9a-f]{64}$'),
  assinado_em timestamptz not null default now(),
  colhido_por uuid not null references public.colaboradores (id)
    default public.colaborador_atual_id(),
  -- User agent resumido.
  dispositivo text check (char_length(dispositivo) <= 200),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index termos_assinados_cliente_idx on public.termos_assinados (cliente_id, assinado_em desc);
create index termos_assinados_modelo_idx on public.termos_assinados (modelo_termo_id);
create index termos_assinados_agendamento_idx on public.termos_assinados (agendamento_id);
create index termos_assinados_colhido_por_idx on public.termos_assinados (colhido_por);

create table public.fotos (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references public.clientes (id),
  agendamento_id uuid references public.agendamentos (id),
  servico_id uuid references public.servicos (id),
  tipo public.tipo_foto not null,
  path text not null unique
    check (path ~ ('^clientes/' || cliente_id::text || '/fotos/[0-9a-f-]{36}\.jpg$')),
  tirada_em timestamptz not null default now(),
  enviada_por uuid not null references public.colaboradores (id)
    default public.colaborador_atual_id(),
  arquivada boolean not null default false,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index fotos_cliente_idx on public.fotos (cliente_id, tirada_em desc);
create index fotos_agendamento_idx on public.fotos (agendamento_id);
create index fotos_servico_idx on public.fotos (servico_id);
create index fotos_enviada_por_idx on public.fotos (enviada_por);

create table public.evolucoes (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references public.clientes (id),
  agendamento_id uuid not null references public.agendamentos (id),
  profissional_id uuid not null references public.colaboradores (id)
    default public.colaborador_atual_id(),
  texto text not null check (length(trim(texto)) > 0 and char_length(texto) <= 5000),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index evolucoes_cliente_idx on public.evolucoes (cliente_id, criado_em desc);
create index evolucoes_agendamento_idx on public.evolucoes (agendamento_id);
create index evolucoes_profissional_idx on public.evolucoes (profissional_id);

create table public.auditoria (
  id uuid primary key default gen_random_uuid(),
  colaborador_id uuid references public.colaboradores (id),
  acao public.acao_auditoria not null,
  entidade text not null,
  entidade_id uuid,
  cliente_id uuid references public.clientes (id),
  ocorrido_em timestamptz not null default now(),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index auditoria_ocorrido_idx on public.auditoria (ocorrido_em desc);
create index auditoria_cliente_ocorrido_idx on public.auditoria (cliente_id, ocorrido_em desc);
create index auditoria_colaborador_idx on public.auditoria (colaborador_id);

-- Triggers de atualizado_em ---------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'modelos_anamnese', 'modelos_termo', 'anamneses', 'termos_assinados',
    'fotos', 'evolucoes', 'auditoria'
  ]
  loop
    execute format(
      'create trigger %1$I before update on public.%2$I
         for each row execute function public.set_atualizado_em()',
      t || '_atualizado_em', t);
  end loop;
end
$$;

-- =============================================================================
-- 3. Acesso clínico e caminhos de arquivo
-- =============================================================================

-- Áreas anamneses, termos, evolucoes, pacotes: dona e recepção sempre;
-- profissional só nas clientes vinculadas. Fotos: dona sempre; profissional
-- vinculada; recepção nunca. Outra área, cliente nulo ou sem perfil: false.
create function public.acesso_clinico(p_cliente uuid, p_area text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    p_cliente is not null
    and case
      when p_area in ('anamneses', 'termos', 'evolucoes', 'pacotes') then
        public.perfil_atual() in ('dona', 'recepcao')
        or (public.perfil_atual() = 'profissional' and public.cliente_vinculada(p_cliente))
      when p_area = 'fotos' then
        public.perfil_atual() = 'dona'
        or (public.perfil_atual() = 'profissional' and public.cliente_vinculada(p_cliente))
      else false
    end,
    false
  )
$$;

-- clientes/<uuid>/<área>/<uuid>.<ext> → cliente / área; null se não casar
-- (nunca faz cast de texto inválido: caminho adulterado vira "sem acesso").
create function public.cliente_do_caminho(p_nome text)
returns uuid
language sql
immutable
parallel safe
set search_path = ''
as $$
  select (regexp_match(
    p_nome,
    '^clientes/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/(anamneses|termos|fotos)/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|pdf)$'
  ))[1]::uuid
$$;

create function public.area_do_caminho(p_nome text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select (regexp_match(
    p_nome,
    '^clientes/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/(anamneses|termos|fotos)/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|pdf)$'
  ))[2]
$$;

-- =============================================================================
-- 4. Auditoria
-- =============================================================================

-- Leitura de dado clínico, registrada pelo servidor ANTES de entregar o dado.
-- Sem acesso: 'Acesso não autorizado' (e nada é entregue).
create function public.registrar_acesso(p_entidade text, p_entidade_id uuid, p_cliente uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_permitido boolean;
begin
  if p_entidade is null
     or p_entidade not in ('anamneses', 'termos_assinados', 'fotos', 'evolucoes', 'exportacao') then
    raise exception 'Entidade inválida' using errcode = 'P0001';
  end if;

  v_permitido := case p_entidade
    when 'termos_assinados' then public.acesso_clinico(p_cliente, 'termos')
    when 'exportacao' then p_cliente is not null
                           and public.perfil_atual() is not distinct from 'dona'
    else public.acesso_clinico(p_cliente, p_entidade)
  end;
  if not coalesce(v_permitido, false) then
    raise exception 'Acesso não autorizado' using errcode = 'P0001';
  end if;

  insert into public.auditoria (colaborador_id, acao, entidade, entidade_id, cliente_id)
  values (public.colaborador_atual_id(), 'visualizou', p_entidade, p_entidade_id, p_cliente);
end;
$$;

-- Escritas nas tabelas clínicas: insert → criou; foto arquivada → arquivou;
-- demais updates → alterou.
create function public.auditar_ficha()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_acao public.acao_auditoria;
begin
  if tg_op = 'INSERT' then
    v_acao := 'criou';
  elsif tg_table_name = 'fotos'
        and (to_jsonb(new) ->> 'arquivada')::boolean
        and not (to_jsonb(old) ->> 'arquivada')::boolean then
    v_acao := 'arquivou';
  else
    v_acao := 'alterou';
  end if;

  insert into public.auditoria (colaborador_id, acao, entidade, entidade_id, cliente_id)
  values (public.colaborador_atual_id(), v_acao, tg_table_name, new.id, new.cliente_id);
  return null;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array['anamneses', 'termos_assinados', 'fotos', 'evolucoes']
  loop
    execute format(
      'create trigger %1$I after insert or update on public.%2$I
         for each row execute function public.auditar_ficha()',
      t || '_auditoria', t);
  end loop;
end
$$;

-- Guardas (before update; rodam depois de *_atualizado_em, por ordem alfabética)

-- Foto só é arquivada (false → true); nada mais muda.
create function public.fotos_guarda()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (to_jsonb(new) - 'arquivada' - 'atualizado_em')
       is distinct from (to_jsonb(old) - 'arquivada' - 'atualizado_em')
     or old.arquivada
     or not new.arquivada
  then
    raise exception 'Fotos só podem ser arquivadas' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger fotos_guarda before update on public.fotos
  for each row execute function public.fotos_guarda();

-- Evolução: só o texto, só a autora, só nas primeiras 24 horas.
create function public.evolucoes_guarda()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (to_jsonb(new) - 'texto' - 'atualizado_em')
       is distinct from (to_jsonb(old) - 'texto' - 'atualizado_em')
     or old.profissional_id is distinct from public.colaborador_atual_id()
     or now() > old.criado_em + interval '24 hours'
  then
    raise exception 'A evolução só pode ser editada pela autora em até 24 horas'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger evolucoes_guarda before update on public.evolucoes
  for each row execute function public.evolucoes_guarda();

-- =============================================================================
-- 5. Edição de modelos (só a dona; cria nova versão)
-- =============================================================================

create function public.salvar_modelo_anamnese(p_titulo text, p_perguntas jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if public.perfil_atual() is distinct from 'dona' then
    raise exception 'Apenas a dona pode editar modelos' using errcode = 'P0001';
  end if;
  if p_perguntas is null
     or jsonb_typeof(p_perguntas) <> 'array'
     or jsonb_array_length(p_perguntas) < 1 then
    raise exception 'O modelo precisa de ao menos uma pergunta' using errcode = 'P0001';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_perguntas) p
    where jsonb_typeof(p) <> 'object'
       or jsonb_typeof(p -> 'id') is distinct from 'string'
       or jsonb_typeof(p -> 'texto') is distinct from 'string'
       or length(trim(p ->> 'id')) = 0
       or length(trim(p ->> 'texto')) = 0
       or (p ->> 'tipo') is null
       or (p ->> 'tipo') not in ('texto', 'sim_nao', 'sim_nao_detalhe', 'multipla', 'data')
  ) then
    raise exception 'Pergunta inválida no modelo' using errcode = 'P0001';
  end if;

  -- Trava a versão ativa contra uma edição simultânea.
  perform 1 from public.modelos_anamnese m where m.ativo for update;
  update public.modelos_anamnese set ativo = false where ativo;

  insert into public.modelos_anamnese (titulo, versao, perguntas, ativo)
  select p_titulo, coalesce(max(m.versao), 0) + 1, p_perguntas, true
  from public.modelos_anamnese m
  returning id into v_id;
  return v_id;
end;
$$;

-- p_anterior nulo: termo novo (grupo novo, v1). Senão: nova versão do mesmo
-- grupo; a anterior é desativada e os serviços passam a apontar para a nova.
create function public.salvar_modelo_termo(p_anterior uuid, p_titulo text, p_texto text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_anterior public.modelos_termo;
  v_id uuid;
begin
  if public.perfil_atual() is distinct from 'dona' then
    raise exception 'Apenas a dona pode editar modelos' using errcode = 'P0001';
  end if;

  if p_anterior is null then
    insert into public.modelos_termo (titulo, texto, versao, ativo)
    values (p_titulo, p_texto, 1, true)
    returning id into v_id;
    return v_id;
  end if;

  select * into v_anterior
  from public.modelos_termo m
  where m.id = p_anterior
  for update;
  if not found or not v_anterior.ativo then
    raise exception 'Este termo foi alterado por outra pessoa. Recarregue a página.'
      using errcode = 'P0001';
  end if;

  update public.modelos_termo set ativo = false where id = p_anterior;
  insert into public.modelos_termo (grupo_id, titulo, texto, versao, ativo)
  values (v_anterior.grupo_id, p_titulo, p_texto, v_anterior.versao + 1, true)
  returning id into v_id;

  update public.servicos set modelo_termo_id = v_id where modelo_termo_id = p_anterior;
  return v_id;
end;
$$;

-- =============================================================================
-- 6. Pendências e alertas
-- =============================================================================

-- Para cada cliente visível (RLS de clientes e anamneses): data da última
-- anamnese e se ela tem "sim" em alguma pergunta de alerta do modelo daquela
-- versão (sim_nao: true; sim_nao_detalhe: { "sim": true, ... }).
create function public.situacao_ficha(p_clientes uuid[])
returns table (cliente_id uuid, ultima_anamnese_em timestamptz, tem_alerta boolean)
language sql
stable
security invoker
set search_path = ''
as $$
  select c.id,
         u.preenchida_em,
         coalesce(exists (
           select 1
           from jsonb_array_elements(m.perguntas) p
           where p -> 'alerta' = 'true'::jsonb
             and (
               (p ->> 'tipo' = 'sim_nao'
                 and u.respostas -> (p ->> 'id') = 'true'::jsonb)
               or (p ->> 'tipo' = 'sim_nao_detalhe'
                 and u.respostas -> (p ->> 'id') -> 'sim' = 'true'::jsonb)
             )
         ), false)
  from public.clientes c
  left join lateral (
    select a.preenchida_em, a.respostas, a.modelo_id
    from public.anamneses a
    where a.cliente_id = c.id
    order by a.preenchida_em desc
    limit 1
  ) u on true
  left join public.modelos_anamnese m on m.id = u.modelo_id
  where c.id = any (p_clientes)
$$;

-- Atendimentos (entre os informados) cujo serviço exige termo e a cliente
-- ainda não assinou a versão atual (servicos.modelo_termo_id).
create function public.agendamentos_com_termo_pendente(p_ids uuid[])
returns setof uuid
language sql
stable
security invoker
set search_path = ''
as $$
  select a.id
  from public.agendamentos a
  join public.servicos s on s.id = a.servico_id
  where a.id = any (p_ids)
    and s.modelo_termo_id is not null
    and not exists (
      select 1
      from public.termos_assinados t
      where t.cliente_id = a.cliente_id
        and t.modelo_termo_id = s.modelo_termo_id
    )
  order by a.inicio
$$;

-- Atendidos no período (dias de São Paulo, inclusive; até 62 dias) com termo
-- pendente. Só a dona; os demais recebem vazio.
create function public.atendimentos_sem_termo(p_de date, p_ate date)
returns setof uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_de is null or p_ate is null or p_ate < p_de or p_ate - p_de > 61 then
    raise exception 'Período inválido' using errcode = 'P0001';
  end if;
  if public.perfil_atual() is distinct from 'dona' then
    return;
  end if;
  return query
    select a.id
    from public.agendamentos a
    join public.servicos s on s.id = a.servico_id
    where a.status = 'atendido'
      and s.modelo_termo_id is not null
      and a.inicio >= (p_de::timestamp at time zone 'America/Sao_Paulo')
      and a.inicio < ((p_ate + 1)::timestamp at time zone 'America/Sao_Paulo')
      and not exists (
        select 1
        from public.termos_assinados t
        where t.cliente_id = a.cliente_id
          and t.modelo_termo_id = s.modelo_termo_id
      )
    order by a.inicio;
end;
$$;

-- Privilégios das funções -----------------------------------------------------
revoke execute on function public.acesso_clinico(uuid, text) from public, anon;
revoke execute on function public.cliente_do_caminho(text) from public, anon;
revoke execute on function public.area_do_caminho(text) from public, anon;
revoke execute on function public.registrar_acesso(text, uuid, uuid) from public, anon;
revoke execute on function public.salvar_modelo_anamnese(text, jsonb) from public, anon;
revoke execute on function public.salvar_modelo_termo(uuid, text, text) from public, anon;
revoke execute on function public.situacao_ficha(uuid[]) from public, anon;
revoke execute on function public.agendamentos_com_termo_pendente(uuid[]) from public, anon;
revoke execute on function public.atendimentos_sem_termo(date, date) from public, anon;
revoke execute on function public.auditar_ficha() from public, anon, authenticated;
revoke execute on function public.fotos_guarda() from public, anon, authenticated;
revoke execute on function public.evolucoes_guarda() from public, anon, authenticated;

-- acesso_clinico e os de caminho são chamados pelas políticas (avaliadas com o
-- papel da usuária).
grant execute on function public.acesso_clinico(uuid, text) to authenticated;
grant execute on function public.cliente_do_caminho(text) to authenticated;
grant execute on function public.area_do_caminho(text) to authenticated;
grant execute on function public.registrar_acesso(text, uuid, uuid) to authenticated;
grant execute on function public.salvar_modelo_anamnese(text, jsonb) to authenticated;
grant execute on function public.salvar_modelo_termo(uuid, text, text) to authenticated;
grant execute on function public.situacao_ficha(uuid[]) to authenticated;
grant execute on function public.agendamentos_com_termo_pendente(uuid[]) to authenticated;
grant execute on function public.atendimentos_sem_termo(date, date) to authenticated;

-- =============================================================================
-- RLS e privilégios das tabelas
-- =============================================================================

alter table public.modelos_anamnese enable row level security;
alter table public.modelos_termo enable row level security;
alter table public.anamneses enable row level security;
alter table public.termos_assinados enable row level security;
alter table public.fotos enable row level security;
alter table public.evolucoes enable row level security;
alter table public.auditoria enable row level security;

-- Anônimo não toca em nada; ninguém apaga dado clínico (nem trunca).
revoke all on public.modelos_anamnese, public.modelos_termo, public.anamneses,
  public.termos_assinados, public.fotos, public.evolucoes, public.auditoria
  from anon;
revoke delete, truncate on public.anamneses, public.termos_assinados,
  public.fotos, public.evolucoes
  from authenticated;
-- Modelos e auditoria: escrita só pelas funções security definer / gatilhos.
revoke insert, update, delete, truncate on public.modelos_anamnese,
  public.modelos_termo, public.auditoria
  from authenticated;

create policy modelos_anamnese_select on public.modelos_anamnese
  for select to authenticated
  using ((select public.perfil_atual()) is not null);
create policy modelos_termo_select on public.modelos_termo
  for select to authenticated
  using ((select public.perfil_atual()) is not null);

-- anamneses: vê quem tem acesso; aplicam dona e recepção (em nome próprio).
create policy anamneses_select on public.anamneses
  for select to authenticated
  using (public.acesso_clinico(cliente_id, 'anamneses'));
create policy anamneses_insert on public.anamneses
  for insert to authenticated
  with check (
    (select public.perfil_atual()) in ('dona', 'recepcao')
    and preenchida_por = (select public.colaborador_atual_id())
  );

-- termos_assinados: vê e colhe quem tem acesso à área termos.
create policy termos_assinados_select on public.termos_assinados
  for select to authenticated
  using (public.acesso_clinico(cliente_id, 'termos'));
create policy termos_assinados_insert on public.termos_assinados
  for insert to authenticated
  with check (
    public.acesso_clinico(cliente_id, 'termos')
    and colhido_por = (select public.colaborador_atual_id())
  );

-- fotos: arquivadas só a dona vê; arquivar (update) só a dona — o que muda é
-- limitado por fotos_guarda.
create policy fotos_select on public.fotos
  for select to authenticated
  using (
    public.acesso_clinico(cliente_id, 'fotos')
    and (not arquivada or (select public.perfil_atual()) = 'dona')
  );
create policy fotos_insert on public.fotos
  for insert to authenticated
  with check (
    public.acesso_clinico(cliente_id, 'fotos')
    and enviada_por = (select public.colaborador_atual_id())
  );
create policy fotos_update on public.fotos
  for update to authenticated
  using ((select public.perfil_atual()) = 'dona')
  with check ((select public.perfil_atual()) = 'dona');

-- evolucoes: a profissional registra no próprio atendimento da cliente;
-- edição limitada por evolucoes_guarda.
create policy evolucoes_select on public.evolucoes
  for select to authenticated
  using (public.acesso_clinico(cliente_id, 'evolucoes'));
create policy evolucoes_insert on public.evolucoes
  for insert to authenticated
  with check (
    (select public.perfil_atual()) = 'profissional'
    and profissional_id = (select public.colaborador_atual_id())
    and exists (
      select 1
      from public.agendamentos a
      where a.id = agendamento_id
        and a.cliente_id = evolucoes.cliente_id
        and a.profissional_id = (select public.colaborador_atual_id())
    )
  );
create policy evolucoes_update on public.evolucoes
  for update to authenticated
  using (profissional_id = (select public.colaborador_atual_id()))
  with check (profissional_id = (select public.colaborador_atual_id()));

-- auditoria: só a dona lê; escrita só por registrar_acesso e auditar_ficha.
create policy auditoria_select on public.auditoria
  for select to authenticated
  using ((select public.perfil_atual()) = 'dona');

-- =============================================================================
-- Storage: bucket privado e políticas
--
-- Leitura: mesma regra das tabelas, pela área do caminho. Envio pelo
-- navegador: só fotos (.jpg) — assinaturas e PDFs são gravados pelo servidor
-- com o cliente admin. Sem update/delete: nada é sobrescrito nem apagado.
-- =============================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'ficha-clinica', 'ficha-clinica', false, 5242880,
  array['image/jpeg', 'image/png', 'application/pdf']
)
on conflict (id) do nothing;

create policy ficha_clinica_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'ficha-clinica'
    and public.acesso_clinico(public.cliente_do_caminho(name), public.area_do_caminho(name))
  );

create policy ficha_clinica_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'ficha-clinica'
    and public.area_do_caminho(name) = 'fotos'
    and name like '%.jpg'
    and public.acesso_clinico(public.cliente_do_caminho(name), 'fotos')
  );

-- =============================================================================
-- Dados iniciais
-- =============================================================================
insert into public.modelos_anamnese (titulo, versao, perguntas, ativo)
values (
  'Anamnese de estética',
  1,
  '[
    {"id": "queixa", "tipo": "texto", "texto": "Qual é a sua principal queixa ou objetivo?", "obrigatoria": true, "alerta": false},
    {"id": "alergias", "tipo": "sim_nao_detalhe", "texto": "Tem alguma alergia (medicamentos, cosméticos, alimentos)?", "obrigatoria": true, "alerta": true},
    {"id": "gestante", "tipo": "sim_nao", "texto": "Está grávida ou amamentando?", "obrigatoria": true, "alerta": true},
    {"id": "medicamentos", "tipo": "sim_nao_detalhe", "texto": "Usa algum medicamento contínuo?", "obrigatoria": true, "alerta": false},
    {"id": "anticoagulante", "tipo": "sim_nao", "texto": "Usa anticoagulante?", "obrigatoria": true, "alerta": true},
    {"id": "condicoes", "tipo": "multipla", "texto": "Tem ou já teve alguma destas condições?", "obrigatoria": false, "alerta": false,
     "opcoes": ["Diabetes", "Hipertensão", "Problemas cardíacos", "Problemas de tireoide", "Epilepsia", "Doença autoimune", "Nenhuma"]},
    {"id": "marcapasso", "tipo": "sim_nao", "texto": "Usa marcapasso ou tem implante metálico?", "obrigatoria": false, "alerta": true},
    {"id": "queloide", "tipo": "sim_nao", "texto": "Tem tendência a queloide ou cicatrização difícil?", "obrigatoria": false, "alerta": true},
    {"id": "herpes", "tipo": "sim_nao", "texto": "Tem histórico de herpes?", "obrigatoria": false, "alerta": true},
    {"id": "isotretinoina", "tipo": "sim_nao", "texto": "Usou isotretinoína (Roacutan) nos últimos 6 meses?", "obrigatoria": false, "alerta": true},
    {"id": "procedimentos", "tipo": "sim_nao_detalhe", "texto": "Fez algum procedimento estético nos últimos 6 meses?", "obrigatoria": false, "alerta": false},
    {"id": "sol", "tipo": "sim_nao", "texto": "Tem exposição frequente ao sol?", "obrigatoria": false, "alerta": false},
    {"id": "rotina", "tipo": "texto", "texto": "Quais produtos usa na pele diariamente?", "obrigatoria": false, "alerta": false}
  ]'::jsonb,
  true
);

insert into public.modelos_termo (titulo, texto, versao, ativo)
values (
  'Termo de consentimento — modelo genérico',
  $termo$# Procedimento

Eu, abaixo identificada, autorizo a realização do procedimento estético indicado pela profissional da clínica, após ter recebido explicações claras sobre como ele é feito, quantas sessões podem ser necessárias e quais resultados posso esperar. Entendo que os resultados variam de pessoa para pessoa.

# Riscos e cuidados

Fui informada de que podem ocorrer vermelhidão, inchaço, sensibilidade ou manchas temporárias, e de que reações alérgicas são raras, mas possíveis. Comprometo-me a seguir as orientações de cuidados antes e depois do procedimento (como uso de protetor solar e evitar exposição ao sol) e a avisar a clínica sobre qualquer reação.

# Declaração

Declaro que as informações que prestei na anamnese são verdadeiras, que pude tirar todas as minhas dúvidas e que concordo com a realização do procedimento. (Texto de exemplo: a clínica deve adaptá-lo a cada procedimento.)$termo$,
  1,
  true
);

-- =============================================================================
-- 7. Ajustes herdados da Fase 1 (spec §7)
-- =============================================================================
alter function public.normalizar_busca(text) set search_path = '';

create index agendamentos_criado_por_idx on public.agendamentos (criado_por);
create index agendamentos_servico_idx on public.agendamentos (servico_id);
create index caixas_aberto_por_idx on public.caixas (aberto_por);
create index caixas_fechado_por_idx on public.caixas (fechado_por);
create index pagamentos_lancado_por_idx on public.pagamentos (lancado_por);
