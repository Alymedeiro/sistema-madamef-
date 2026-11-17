-- =============================================================================
-- 0020_servicos_fotos — fotos dos serviços (catálogo e agendamento online).
--
--   1. servicos_fotos: até 5 fotos por serviço (gatilho antes do insert, com o
--      serviço travado para não passar do limite em envios simultâneos).
--      ordem 0..4, capa = ordem 0. Sem ordem informada, o gatilho usa a menor
--      posição livre. unique (servico_id, ordem) é DEFERRABLE INITIALLY
--      DEFERRED: reordenar e renumerar regravam várias linhas na mesma
--      transação. Ao remover uma foto, as que sobram são renumeradas 0..n-1
--      (a próxima vira capa).
--      Exceção aceita à regra "nada é apagado": foto do catálogo é
--      configuração da dona; o delete remove a linha e o app apaga o arquivo.
--      FK simples para servicos (sem cascade: serviço não é apagado).
--   2. RLS: authenticated (perfil ativo) lê todas; anon lê só as de serviços
--      ativos com permite_online (servico_publico, security definer, porque o
--      anon não lê servicos). Escrita só da dona.
--   3. reordenar_fotos_servico(p_servico, p_ids): só a dona; p_ids precisa ser
--      exatamente o conjunto de fotos do serviço; regrava ordem 0..n-1.
--   4. Bucket PÚBLICO `servicos-fotos` (2 MB; jpeg/webp/png). A leitura vem do
--      bucket público (URL pública). Em storage.objects: envio, troca e
--      exclusão só da dona, e só na pasta servicos/; select da dona no bucket
--      (a API do Storage lê o objeto antes de apagar/sobrescrever).
-- =============================================================================
set lock_timeout = '5s';

-- =============================================================================
-- 1. Tabela
-- =============================================================================
create table public.servicos_fotos (
  id uuid primary key default gen_random_uuid(),
  servico_id uuid not null references public.servicos (id),
  caminho text not null unique,
  ordem smallint not null check (ordem between 0 and 4),
  largura int check (largura > 0),
  altura int check (altura > 0),
  criado_em timestamptz not null default now(),
  criado_por uuid references public.colaboradores (id) default public.colaborador_atual_id(),
  -- Caminho no bucket: servicos/<servico_id>/<uuid>.webp (ou .jpg sem WebP).
  constraint servicos_fotos_caminho_check check (
    caminho ~ ('^servicos/' || servico_id::text || '/[0-9a-f-]{36}\.(webp|jpg)$')
  ),
  constraint servicos_fotos_ordem_unica unique (servico_id, ordem)
    deferrable initially deferred
);
create index servicos_fotos_servico_idx on public.servicos_fotos (servico_id);

-- Limite de 5 e ordem padrão (menor posição livre).
create function public.servicos_fotos_antes_inserir()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Serializa envios do mesmo serviço.
  perform 1 from public.servicos s where s.id = new.servico_id for update;

  if (select count(*) from public.servicos_fotos f where f.servico_id = new.servico_id) >= 5 then
    raise exception 'Cada serviço pode ter no máximo 5 fotos.' using errcode = 'P0001';
  end if;

  if new.ordem is null then
    select min(g)::smallint into new.ordem
    from generate_series(0, 4) as g
    where not exists (
      select 1 from public.servicos_fotos f
      where f.servico_id = new.servico_id and f.ordem = g
    );
  end if;
  return new;
end
$$;

create trigger servicos_fotos_antes_inserir before insert on public.servicos_fotos
  for each row execute function public.servicos_fotos_antes_inserir();

-- Depois de remover: as que sobram ficam 0..n-1, na ordem em que estavam.
create function public.servicos_fotos_renumerar()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.servicos_fotos f
  set ordem = (n.pos - 1)::smallint
  from (
    select x.id, row_number() over (order by x.ordem, x.criado_em, x.id) as pos
    from public.servicos_fotos x
    where x.servico_id = old.servico_id
  ) n
  where f.id = n.id and f.ordem <> n.pos - 1;
  return null;
end
$$;

create trigger servicos_fotos_renumerar after delete on public.servicos_fotos
  for each row execute function public.servicos_fotos_renumerar();

revoke execute on function public.servicos_fotos_antes_inserir() from public, anon, authenticated;
revoke execute on function public.servicos_fotos_renumerar() from public, anon, authenticated;

-- =============================================================================
-- 2. RLS
-- =============================================================================

-- Serviço visível no link público (o anon não lê servicos).
create function public.servico_publico(p_servico uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.servicos s
    where s.id = p_servico and s.ativo and s.permite_online
  )
$$;
revoke execute on function public.servico_publico(uuid) from public;
grant execute on function public.servico_publico(uuid) to anon, authenticated, service_role;

alter table public.servicos_fotos enable row level security;

create policy servicos_fotos_select_anon on public.servicos_fotos
  for select to anon
  using (public.servico_publico(servico_id));
create policy servicos_fotos_select on public.servicos_fotos
  for select to authenticated
  using ((select public.perfil_atual()) is not null);
create policy servicos_fotos_insert on public.servicos_fotos
  for insert to authenticated
  with check ((select public.perfil_atual()) = 'dona');
create policy servicos_fotos_update on public.servicos_fotos
  for update to authenticated
  using ((select public.perfil_atual()) = 'dona')
  with check ((select public.perfil_atual()) = 'dona');
create policy servicos_fotos_delete on public.servicos_fotos
  for delete to authenticated
  using ((select public.perfil_atual()) = 'dona');

-- =============================================================================
-- 3. Reordenar
-- =============================================================================
create function public.reordenar_fotos_servico(p_servico uuid, p_ids uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select public.perfil_atual()) is distinct from 'dona' then
    raise exception 'Só a dona pode reordenar as fotos.' using errcode = '42501';
  end if;

  perform 1 from public.servicos s where s.id = p_servico for update;

  if coalesce(cardinality(p_ids), 0) = 0
     or (select array_agg(x order by x) from unnest(p_ids) as x)
        is distinct from
        (select array_agg(f.id order by f.id) from public.servicos_fotos f
         where f.servico_id = p_servico) then
    raise exception 'A lista de fotos não confere com as fotos do serviço.' using errcode = 'P0001';
  end if;

  update public.servicos_fotos f
  set ordem = (array_position(p_ids, f.id) - 1)::smallint
  where f.servico_id = p_servico;
end
$$;
revoke execute on function public.reordenar_fotos_servico(uuid, uuid[]) from public, anon;
grant execute on function public.reordenar_fotos_servico(uuid, uuid[]) to authenticated, service_role;

-- =============================================================================
-- 4. Storage: bucket público e políticas
-- =============================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'servicos-fotos', 'servicos-fotos', true, 2097152,
  array['image/jpeg', 'image/webp', 'image/png']
)
on conflict (id) do nothing;

create policy servicos_fotos_storage_select on storage.objects
  for select to authenticated
  using (bucket_id = 'servicos-fotos' and (select public.perfil_atual()) = 'dona');

create policy servicos_fotos_storage_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'servicos-fotos'
    and (storage.foldername(name))[1] = 'servicos'
    and (select public.perfil_atual()) = 'dona'
  );

create policy servicos_fotos_storage_update on storage.objects
  for update to authenticated
  using (bucket_id = 'servicos-fotos' and (select public.perfil_atual()) = 'dona')
  with check (
    bucket_id = 'servicos-fotos'
    and (storage.foldername(name))[1] = 'servicos'
    and (select public.perfil_atual()) = 'dona'
  );

create policy servicos_fotos_storage_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'servicos-fotos' and (select public.perfil_atual()) = 'dona');
