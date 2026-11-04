-- =============================================================================
-- 0001_base — cadastros base, perfis e RLS (Fase 1, Task 3)
--
-- Tabelas: configuracoes_clinica, colaboradores, jornadas, bloqueios_agenda,
-- categorias_servico, servicos, colaborador_servicos, produtos,
-- produtos_custos, servico_produtos, clientes.
--
-- Modelo de permissões: toda política exige um colaborador ATIVO vinculado ao
-- usuário logado (public.perfil_atual() não nulo). Colaborador desativado ou
-- usuário sem colaborador não vê nem altera nada, na hora.
--
-- Fora do escopo desta fase (rulings): colunas do Google Agenda (R8),
-- comissões (R9); custo de produto fica em produtos_custos, só para a dona (R10).
-- =============================================================================

-- Extensões ------------------------------------------------------------------
create schema if not exists extensions;
create extension if not exists btree_gist with schema extensions;
create extension if not exists pg_trgm with schema extensions;
create extension if not exists pgcrypto with schema extensions;

-- Tipos ----------------------------------------------------------------------
create type public.perfil as enum ('dona', 'recepcao', 'profissional');

-- Trigger reutilizável de atualizado_em ---------------------------------------
create function public.set_atualizado_em()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.atualizado_em := now();
  return new;
end;
$$;

-- =============================================================================
-- 5.1 Configuração e equipe
-- =============================================================================

create table public.configuracoes_clinica (
  id uuid primary key default gen_random_uuid(),
  -- Garante uma única linha de configuração.
  linha_unica boolean not null default true unique check (linha_unica),
  nome text not null check (length(trim(nome)) > 0),
  logo_url text,
  endereco text,
  telefone text,
  -- { "0": [], "1": [{"inicio":"09:00","fim":"19:00"}], ... } — chaves 0 (domingo) a 6 (sábado)
  horario_funcionamento jsonb not null default '{}'::jsonb
    check (jsonb_typeof(horario_funcionamento) = 'object'),
  whatsapp_janela_inicio time not null default '08:00',
  whatsapp_janela_fim time not null default '20:00',
  whatsapp_limite_por_hora int not null default 60 check (whatsapp_limite_por_hora > 0),
  dias_cliente_sumida int not null default 90 check (dias_cliente_sumida > 0),
  online_antecedencia_min_horas int not null default 2 check (online_antecedencia_min_horas >= 0),
  online_antecedencia_max_dias int not null default 60 check (online_antecedencia_max_dias > 0),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  constraint configuracoes_clinica_janela_whatsapp_check
    check (whatsapp_janela_fim > whatsapp_janela_inicio)
);

create table public.colaboradores (
  id uuid primary key default gen_random_uuid(),
  usuario_auth_id uuid unique references auth.users (id) on delete set null,
  nome text not null check (length(trim(nome)) > 0),
  funcao text,
  perfil public.perfil not null,
  telefone text check (telefone ~ '^55\d{10,11}$'),
  cor text not null default '#986818' check (cor ~ '^#[0-9A-Fa-f]{6}$'),
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create table public.jornadas (
  id uuid primary key default gen_random_uuid(),
  colaborador_id uuid not null references public.colaboradores (id) on delete cascade,
  dia_semana smallint not null check (dia_semana between 0 and 6),
  hora_inicio time not null,
  hora_fim time not null,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  constraint jornadas_intervalo_check check (hora_fim > hora_inicio)
);
create index jornadas_colaborador_dia_idx on public.jornadas (colaborador_id, dia_semana);

create table public.bloqueios_agenda (
  id uuid primary key default gen_random_uuid(),
  colaborador_id uuid not null references public.colaboradores (id) on delete cascade,
  inicio timestamptz not null,
  fim timestamptz not null,
  motivo text not null check (length(trim(motivo)) > 0),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  constraint bloqueios_agenda_intervalo_check check (fim > inicio)
);
create index bloqueios_agenda_colaborador_inicio_idx on public.bloqueios_agenda (colaborador_id, inicio);

-- =============================================================================
-- 5.2 Serviços e produtos
-- =============================================================================

create table public.categorias_servico (
  id uuid primary key default gen_random_uuid(),
  nome text not null unique check (length(trim(nome)) > 0),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create table public.servicos (
  id uuid primary key default gen_random_uuid(),
  nome text not null check (length(trim(nome)) > 0),
  categoria_id uuid not null references public.categorias_servico (id),
  descricao text,
  duracao_min int not null check (duracao_min between 5 and 480 and duracao_min % 5 = 0),
  preco_centavos int not null default 0 check (preco_centavos >= 0),
  permite_online boolean not null default false,
  exige_avaliacao boolean not null default false,
  dias_retorno int check (dias_retorno >= 1),
  -- FK para modelos_termo é criada na Fase 2, quando a tabela existir.
  modelo_termo_id uuid,
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index servicos_categoria_idx on public.servicos (categoria_id);

create table public.colaborador_servicos (
  id uuid primary key default gen_random_uuid(),
  colaborador_id uuid not null references public.colaboradores (id) on delete cascade,
  servico_id uuid not null references public.servicos (id) on delete cascade,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  constraint colaborador_servicos_unico unique (colaborador_id, servico_id)
);
create index colaborador_servicos_servico_idx on public.colaborador_servicos (servico_id);

create table public.produtos (
  id uuid primary key default gen_random_uuid(),
  nome text not null check (length(trim(nome)) > 0),
  unidade text not null default 'un' check (length(trim(unidade)) > 0),
  preco_venda_centavos int check (preco_venda_centavos >= 0),
  estoque_atual numeric(12, 3) not null default 0,
  estoque_minimo numeric(12, 3) not null default 0 check (estoque_minimo >= 0),
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

-- Custo separado de produtos: só a dona enxerga (R10).
create table public.produtos_custos (
  produto_id uuid primary key references public.produtos (id) on delete cascade,
  custo_unitario_centavos int not null default 0 check (custo_unitario_centavos >= 0),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create table public.servico_produtos (
  id uuid primary key default gen_random_uuid(),
  servico_id uuid not null references public.servicos (id) on delete cascade,
  produto_id uuid not null references public.produtos (id),
  quantidade numeric(12, 3) not null check (quantidade > 0),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  constraint servico_produtos_unico unique (servico_id, produto_id)
);
create index servico_produtos_produto_idx on public.servico_produtos (produto_id);

-- =============================================================================
-- 5.3 Clientes
-- =============================================================================

create table public.clientes (
  id uuid primary key default gen_random_uuid(),
  nome text not null check (length(trim(nome)) > 0),
  -- Só dígitos; único quando informado (nulos não conflitam).
  cpf text check (cpf ~ '^\d{11}$'),
  -- Normalizado: 55 + DDD + número.
  whatsapp text check (whatsapp ~ '^55\d{10,11}$'),
  email text,
  data_nascimento date,
  endereco text,
  origem text check (origem in ('instagram', 'indicacao', 'google', 'passou_na_frente', 'outro')),
  aceite_lgpd_em timestamptz not null,
  aceita_whatsapp_marketing boolean not null default false,
  observacoes text,
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  constraint clientes_cpf_key unique (cpf)
);
create index clientes_nome_trgm_idx on public.clientes using gin (nome extensions.gin_trgm_ops);
create index clientes_whatsapp_idx on public.clientes (whatsapp);

-- Triggers de atualizado_em ---------------------------------------------------
create trigger configuracoes_clinica_atualizado_em before update on public.configuracoes_clinica
  for each row execute function public.set_atualizado_em();
create trigger colaboradores_atualizado_em before update on public.colaboradores
  for each row execute function public.set_atualizado_em();
create trigger jornadas_atualizado_em before update on public.jornadas
  for each row execute function public.set_atualizado_em();
create trigger bloqueios_agenda_atualizado_em before update on public.bloqueios_agenda
  for each row execute function public.set_atualizado_em();
create trigger categorias_servico_atualizado_em before update on public.categorias_servico
  for each row execute function public.set_atualizado_em();
create trigger servicos_atualizado_em before update on public.servicos
  for each row execute function public.set_atualizado_em();
create trigger colaborador_servicos_atualizado_em before update on public.colaborador_servicos
  for each row execute function public.set_atualizado_em();
create trigger produtos_atualizado_em before update on public.produtos
  for each row execute function public.set_atualizado_em();
create trigger produtos_custos_atualizado_em before update on public.produtos_custos
  for each row execute function public.set_atualizado_em();
create trigger servico_produtos_atualizado_em before update on public.servico_produtos
  for each row execute function public.set_atualizado_em();
create trigger clientes_atualizado_em before update on public.clientes
  for each row execute function public.set_atualizado_em();

-- =============================================================================
-- Funções de permissão (security definer: leem colaboradores sem passar pelo RLS)
-- =============================================================================

-- Perfil do colaborador ATIVO vinculado ao usuário logado; null se não houver.
create function public.perfil_atual()
returns public.perfil
language sql
stable
security definer
set search_path = ''
as $$
  select c.perfil
  from public.colaboradores c
  where c.usuario_auth_id = auth.uid()
    and c.ativo
$$;

-- Id do colaborador ATIVO vinculado ao usuário logado; null se não houver.
create function public.colaborador_atual_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select c.id
  from public.colaboradores c
  where c.usuario_auth_id = auth.uid()
    and c.ativo
$$;

-- Cliente vinculada = tem ao menos um agendamento (qualquer status) com o
-- colaborador logado. Retorna false até a Task 4 (0002_agenda) criar
-- `agendamentos` e substituir o corpo.
create function public.cliente_vinculada(p_cliente uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select false
$$;

revoke execute on function public.perfil_atual() from public, anon;
revoke execute on function public.colaborador_atual_id() from public, anon;
revoke execute on function public.cliente_vinculada(uuid) from public, anon;
grant execute on function public.perfil_atual() to authenticated, service_role;
grant execute on function public.colaborador_atual_id() to authenticated, service_role;
grant execute on function public.cliente_vinculada(uuid) to authenticated, service_role;
revoke execute on function public.set_atualizado_em() from public, anon, authenticated;

-- =============================================================================
-- RLS
--
-- Políticas só para `authenticated`; `anon` não tem política e não vê nada.
-- `(select public.perfil_atual())` é avaliado uma vez por comando (initPlan).
-- Comparações `= 'dona'` / `in (...)` já excluem perfil nulo (inativo ou
-- desconhecido); políticas de leitura geral pedem `is not null` explícito.
-- =============================================================================

alter table public.configuracoes_clinica enable row level security;
alter table public.colaboradores enable row level security;
alter table public.jornadas enable row level security;
alter table public.bloqueios_agenda enable row level security;
alter table public.categorias_servico enable row level security;
alter table public.servicos enable row level security;
alter table public.colaborador_servicos enable row level security;
alter table public.produtos enable row level security;
alter table public.produtos_custos enable row level security;
alter table public.servico_produtos enable row level security;
alter table public.clientes enable row level security;

-- configuracoes_clinica: todos leem; dona insere/altera; ninguém exclui.
create policy configuracoes_clinica_select on public.configuracoes_clinica
  for select to authenticated
  using ((select public.perfil_atual()) is not null);
create policy configuracoes_clinica_insert on public.configuracoes_clinica
  for insert to authenticated
  with check ((select public.perfil_atual()) = 'dona');
create policy configuracoes_clinica_update on public.configuracoes_clinica
  for update to authenticated
  using ((select public.perfil_atual()) = 'dona')
  with check ((select public.perfil_atual()) = 'dona');

-- colaboradores: todos leem (agenda precisa de nome, cor, perfil); dona
-- insere/altera; ninguém exclui (desativar = ativo false).
create policy colaboradores_select on public.colaboradores
  for select to authenticated
  using ((select public.perfil_atual()) is not null);
create policy colaboradores_insert on public.colaboradores
  for insert to authenticated
  with check ((select public.perfil_atual()) = 'dona');
create policy colaboradores_update on public.colaboradores
  for update to authenticated
  using ((select public.perfil_atual()) = 'dona')
  with check ((select public.perfil_atual()) = 'dona');

-- Tabelas de leitura geral e escrita da dona (inclusive exclusão).
do $$
declare
  t text;
begin
  foreach t in array array[
    'jornadas', 'bloqueios_agenda', 'colaborador_servicos',
    'categorias_servico', 'servicos', 'servico_produtos', 'produtos'
  ]
  loop
    execute format(
      'create policy %1$I on public.%2$I for select to authenticated
         using ((select public.perfil_atual()) is not null)',
      t || '_select', t);
    execute format(
      'create policy %1$I on public.%2$I for insert to authenticated
         with check ((select public.perfil_atual()) = ''dona'')',
      t || '_insert', t);
    execute format(
      'create policy %1$I on public.%2$I for update to authenticated
         using ((select public.perfil_atual()) = ''dona'')
         with check ((select public.perfil_atual()) = ''dona'')',
      t || '_update', t);
    execute format(
      'create policy %1$I on public.%2$I for delete to authenticated
         using ((select public.perfil_atual()) = ''dona'')',
      t || '_delete', t);
  end loop;
end
$$;

-- produtos_custos: tudo só para a dona (R10).
create policy produtos_custos_select on public.produtos_custos
  for select to authenticated
  using ((select public.perfil_atual()) = 'dona');
create policy produtos_custos_insert on public.produtos_custos
  for insert to authenticated
  with check ((select public.perfil_atual()) = 'dona');
create policy produtos_custos_update on public.produtos_custos
  for update to authenticated
  using ((select public.perfil_atual()) = 'dona')
  with check ((select public.perfil_atual()) = 'dona');
create policy produtos_custos_delete on public.produtos_custos
  for delete to authenticated
  using ((select public.perfil_atual()) = 'dona');

-- clientes: dona e recepção veem todas; profissional só as vinculadas.
-- Dona e recepção cadastram/editam. Ninguém exclui (exclusão lógica).
create policy clientes_select on public.clientes
  for select to authenticated
  using (
    (select public.perfil_atual()) in ('dona', 'recepcao')
    or (
      (select public.perfil_atual()) = 'profissional'
      and public.cliente_vinculada(id)
    )
  );
create policy clientes_insert on public.clientes
  for insert to authenticated
  with check ((select public.perfil_atual()) in ('dona', 'recepcao'));
create policy clientes_update on public.clientes
  for update to authenticated
  using ((select public.perfil_atual()) in ('dona', 'recepcao'))
  with check ((select public.perfil_atual()) in ('dona', 'recepcao'));
