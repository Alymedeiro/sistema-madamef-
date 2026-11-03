-- =============================================================================
-- 0004 — Busca de clientes sem acento
--
-- `unaccent` não é IMMUTABLE, então não serve direto em coluna gerada nem em
-- índice. `normalizar_busca` o envolve (dicionário e função qualificados pelo
-- schema `extensions`, sem depender do search_path) e é declarada IMMUTABLE:
-- as regras do dicionário `unaccent` não mudam com os dados.
--
-- O app normaliza o termo do mesmo jeito (minúsculas, sem acento) e consulta
-- `nome_busca ilike '%termo%'`, atendido pelo índice de trigramas.
--
-- Dependências: 0001_base (clientes, schema extensions, pg_trgm).
-- =============================================================================

create extension if not exists unaccent with schema extensions;

create function public.normalizar_busca(texto text)
returns text
language sql
immutable
parallel safe
as $$
  select lower(extensions.unaccent('extensions.unaccent'::regdictionary, texto))
$$;

alter table public.clientes
  add column nome_busca text
  generated always as (public.normalizar_busca(nome)) stored;

create index clientes_nome_busca_trgm_idx
  on public.clientes using gin (nome_busca extensions.gin_trgm_ops);

-- O índice sobre o nome cru deixou de ser usado: toda busca vai por nome_busca.
drop index public.clientes_nome_trgm_idx;
