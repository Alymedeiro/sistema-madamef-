-- =============================================================================
-- Camada de compatibilidade Supabase — SOMENTE PARA TESTES (Ruling R1).
--
-- Recria, num PostgreSQL 16 puro, o mínimo que o Supabase já traz pronto:
-- papéis anon / authenticated / service_role, o schema `auth` com `auth.users`
-- e as funções auth.uid() / auth.role() / auth.jwt(), o schema `extensions` e
-- os GRANTs padrão do Supabase.
--
-- NUNCA mova este arquivo para supabase/migrations: num projeto Supabase real
-- tudo isto já existe e não pode ser recriado.
-- =============================================================================

-- Papéis (são globais ao cluster, por isso a criação é idempotente).
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit nobypassrls;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit nobypassrls;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end
$$;

-- Schema de extensões (no Supabase já existe).
create schema if not exists extensions;
grant usage on schema extensions to anon, authenticated, service_role;

-- Schema auth (no Supabase é mantido pelo GoTrue).
create schema if not exists auth;
grant usage on schema auth to anon, authenticated, service_role;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  encrypted_password text,
  created_at timestamptz default now()
);

-- Mesmas definições usadas pelo Supabase (lêem as claims do JWT da requisição).
create or replace function auth.uid() returns uuid
language sql stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
  )::uuid
$$;

create or replace function auth.role() returns text
language sql stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'
  )::text
$$;

create or replace function auth.jwt() returns jsonb
language sql stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')
  )::jsonb
$$;

grant execute on function auth.uid(), auth.role(), auth.jwt()
  to anon, authenticated, service_role;

-- GRANTs padrão do Supabase no schema public: as permissões de verdade ficam
-- a cargo do RLS.
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on functions to anon, authenticated, service_role;

-- =============================================================================
-- Storage — SOMENTE PARA TESTES — no Supabase real o schema storage já existe
-- (mantido por supabase_storage_admin, com RLS ligado em storage.objects).
--
-- Modelo mínimo com as mesmas colunas, chaves e funções auxiliares do Supabase
-- (storage.foldername / filename / extension), para que as políticas escritas
-- nas migrações para o Supabase real rodem aqui sem mudança. Tamanho e tipo
-- dos arquivos são conferidos pela API do Storage, não pelo banco.
-- =============================================================================
create schema if not exists storage;
grant usage on schema storage to anon, authenticated, service_role;

create table if not exists storage.buckets (
  id text primary key,
  name text not null,
  owner uuid,
  owner_id text,
  public boolean default false,
  avif_autodetection boolean default false,
  file_size_limit bigint,
  allowed_mime_types text[],
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create unique index if not exists bname on storage.buckets (name);

create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets (id),
  name text,
  owner uuid,
  owner_id text,
  metadata jsonb,
  user_metadata jsonb,
  version text,
  path_tokens text[] generated always as (string_to_array(name, '/')) stored,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  last_accessed_at timestamptz default now()
);
create unique index if not exists bucketid_objname on storage.objects (bucket_id, name);

alter table storage.buckets enable row level security;
alter table storage.objects enable row level security;

grant all on storage.buckets to anon, authenticated, service_role;
grant select, insert, update, delete on storage.objects
  to anon, authenticated, service_role;

-- Mesmas definições do Supabase.
create or replace function storage.foldername(name text) returns text[]
language plpgsql immutable
as $$
declare
  _parts text[];
begin
  select string_to_array(name, '/') into _parts;
  return _parts[1:array_length(_parts, 1) - 1];
end
$$;

create or replace function storage.filename(name text) returns text
language plpgsql immutable
as $$
declare
  _parts text[];
begin
  select string_to_array(name, '/') into _parts;
  return _parts[array_length(_parts, 1)];
end
$$;

create or replace function storage.extension(name text) returns text
language plpgsql immutable
as $$
declare
  _parts text[];
  _filename text;
begin
  select string_to_array(name, '/') into _parts;
  select _parts[array_length(_parts, 1)] into _filename;
  return reverse(split_part(reverse(_filename), '.', 1));
end
$$;

grant execute on function storage.foldername(text), storage.filename(text),
  storage.extension(text) to anon, authenticated, service_role;
