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
