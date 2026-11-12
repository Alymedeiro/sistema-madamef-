-- =============================================================================
-- 0018_conversas_arquivadas — arquivar conversas da tela Mensagens.
--
-- Nada é apagado: arquivar só esconde a conversa da lista até chegar mensagem
-- nova da cliente. A regra de exibição fica no TS (dados.ts): a conversa está
-- arquivada se existe linha aqui com arquivada_em >= horário da última
-- mensagem RECEBIDA dela (mensagem nova da cliente depois de arquivar traz a
-- conversa de volta; mensagens enviadas pela clínica não).
--
-- `chave` é EXATAMENTE a chave de agruparConversas (src/app/(app)/mensagens/
-- dados.ts): o cliente_id como texto quando há cliente; senão o telefone
-- normalizado por chaveTelefone (55DD + 8 dígitos vira 55DD + 9 + 8 dígitos).
--
-- Escrita pelas funções arquivar_conversas / desarquivar_conversas (dona e
-- recepção); a RLS também libera select/insert/delete a elas e update só de
-- arquivada_em. Profissional e anônimo não veem nem alteram nada.
--
-- Dependências: 0001_base (colaboradores, perfil_atual, colaborador_atual_id),
-- 0012_whatsapp (exigir_equipe_whatsapp).
-- =============================================================================

create table public.conversas_arquivadas (
  chave text primary key check (char_length(chave) between 1 and 200),
  arquivada_em timestamptz not null default now(),
  arquivada_por uuid references public.colaboradores (id)
    default public.colaborador_atual_id()
);

create index conversas_arquivadas_por_idx on public.conversas_arquivadas (arquivada_por);

alter table public.conversas_arquivadas enable row level security;

revoke all on public.conversas_arquivadas from anon, authenticated;
grant select, insert, delete on public.conversas_arquivadas to authenticated;
grant update (arquivada_em) on public.conversas_arquivadas to authenticated;

create policy conversas_arquivadas_select on public.conversas_arquivadas
  for select to authenticated
  using ((select public.perfil_atual()) in ('dona', 'recepcao'));

create policy conversas_arquivadas_insert on public.conversas_arquivadas
  for insert to authenticated
  with check ((select public.perfil_atual()) in ('dona', 'recepcao'));

create policy conversas_arquivadas_update on public.conversas_arquivadas
  for update to authenticated
  using ((select public.perfil_atual()) in ('dona', 'recepcao'))
  with check ((select public.perfil_atual()) in ('dona', 'recepcao'));

create policy conversas_arquivadas_delete on public.conversas_arquivadas
  for delete to authenticated
  using ((select public.perfil_atual()) in ('dona', 'recepcao'));

-- Arquiva (ou arquiva de novo: regrava arquivada_em = agora). 1 a 200 chaves
-- distintas; devolve quantas. Vazio → P0001.
create function public.arquivar_conversas(p_chaves text[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_chaves text[];
begin
  perform public.exigir_equipe_whatsapp();

  select coalesce(array_agg(distinct btrim(c)) filter (where btrim(c) <> ''), '{}')
    into v_chaves
  from unnest(coalesce(p_chaves, '{}')) as c;

  if cardinality(v_chaves) = 0 then
    raise exception 'Escolha pelo menos uma conversa.' using errcode = 'P0001';
  elsif cardinality(v_chaves) > 200 then
    raise exception 'Escolha no máximo 200 conversas por vez.' using errcode = 'P0001';
  elsif exists (select 1 from unnest(v_chaves) c where char_length(c) > 200) then
    raise exception 'Conversa inválida.' using errcode = 'P0001';
  end if;

  insert into public.conversas_arquivadas as a (chave, arquivada_em, arquivada_por)
  select c, now(), public.colaborador_atual_id() from unnest(v_chaves) c
  on conflict (chave) do update
    set arquivada_em = excluded.arquivada_em, arquivada_por = excluded.arquivada_por;

  return cardinality(v_chaves);
end;
$$;

-- Desarquiva: apaga a marca (a conversa volta à lista). Devolve quantas
-- estavam arquivadas. Vazio → P0001.
create function public.desarquivar_conversas(p_chaves text[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_chaves text[];
  v_n integer;
begin
  perform public.exigir_equipe_whatsapp();

  select coalesce(array_agg(distinct btrim(c)) filter (where btrim(c) <> ''), '{}')
    into v_chaves
  from unnest(coalesce(p_chaves, '{}')) as c;

  if cardinality(v_chaves) = 0 then
    raise exception 'Escolha pelo menos uma conversa.' using errcode = 'P0001';
  elsif cardinality(v_chaves) > 200 then
    raise exception 'Escolha no máximo 200 conversas por vez.' using errcode = 'P0001';
  end if;

  delete from public.conversas_arquivadas a where a.chave = any (v_chaves);
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke execute on function public.arquivar_conversas(text[]) from public, anon, authenticated;
grant execute on function public.arquivar_conversas(text[]) to authenticated;
revoke execute on function public.desarquivar_conversas(text[]) from public, anon, authenticated;
grant execute on function public.desarquivar_conversas(text[]) to authenticated;
