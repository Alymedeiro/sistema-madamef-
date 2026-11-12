-- =============================================================================
-- 0018_whatsapp_midia — mídia recebida do WhatsApp (foto, figurinha, vídeo,
-- áudio e documento)
--
--   1. mensagens_recebidas ganha as colunas da mídia: tipo, URL de origem (do
--      provedor), caminho no Storage, mime, nome, tamanho, status do download
--      e legenda. Mensagem com mídia tem texto vazio e é sempre 'para_ler'.
--   2. registrar_recebida_midia (service_role): registra pela registrar_recebida
--      de 0017 (com texto vazio: cliente, agendamento, idempotência e o robô
--      ficam iguais; para o robô, mídia sem texto é texto não reconhecido →
--      menu ou "não entendi") e grava a mídia como 'pendente'.
--   3. gravar_midia_recebida (service_role): resultado do download feito pelo
--      servidor ('salva' com o caminho, 'falhou' ou 'grande_demais'). Uma mídia
--      já salva não volta atrás.
--   4. Bucket privado `whatsapp-midia` (16 MB, qualquer tipo): dona e recepção
--      leem (o servidor gera URLs assinadas curtas); só o service_role grava.
--      Sem update/delete pelo app. (No Supabase real o RLS de storage.objects
--      já está ligado; o service_role ignora o RLS.)
-- =============================================================================

-- =============================================================================
-- 1. Colunas
-- =============================================================================
alter table public.mensagens_recebidas
  add column midia_tipo text
    check (midia_tipo in ('imagem', 'figurinha', 'video', 'audio', 'documento')),
  add column midia_url_origem text check (char_length(midia_url_origem) <= 4096),
  add column midia_path text check (char_length(midia_path) between 1 and 300),
  add column midia_mime text check (char_length(midia_mime) <= 200),
  add column midia_nome text check (char_length(midia_nome) <= 255),
  add column midia_tamanho int check (midia_tamanho >= 0),
  add column midia_status text
    check (midia_status in ('pendente', 'salva', 'falhou', 'grande_demais')),
  add column legenda text check (char_length(legenda) <= 2000),
  -- Mídia e status andam juntos; sem mídia, nenhum campo de mídia nem legenda.
  add constraint mensagens_recebidas_midia_check check (
    (midia_tipo is null) = (midia_status is null)
    and (
      midia_tipo is not null
      or (midia_url_origem is null and midia_path is null and midia_mime is null
          and midia_nome is null and midia_tamanho is null and legenda is null)
    )
  ),
  add constraint mensagens_recebidas_midia_salva_check
    check (midia_status is distinct from 'salva' or midia_path is not null);

comment on column public.mensagens_recebidas.midia_path is
  'Caminho no bucket whatsapp-midia: <aaaa>/<mm>/<id>.<ext>.';

-- =============================================================================
-- 2. registrar_recebida_midia
-- =============================================================================
create function public.registrar_recebida_midia(
  p_telefone text,
  p_id_externo text,
  p_midia_tipo text,
  p_midia_url_origem text,
  p_midia_mime text default null,
  p_midia_nome text default null,
  p_midia_tamanho int default null,
  p_legenda text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_id_externo is null or btrim(p_id_externo) = '' then
    raise exception 'Mensagem sem identificador.' using errcode = 'P0001';
  end if;
  if p_midia_tipo is null
     or p_midia_tipo not in ('imagem', 'figurinha', 'video', 'audio', 'documento') then
    raise exception 'Tipo de mídia inválido.' using errcode = 'P0001';
  end if;
  if p_midia_url_origem is null or btrim(p_midia_url_origem) = ''
     or char_length(p_midia_url_origem) > 4096 then
    raise exception 'Mídia sem endereço.' using errcode = 'P0001';
  end if;

  -- Repetida: devolve a primeira e não mexe em nada.
  select r.id into v_id from public.mensagens_recebidas r where r.id_externo = p_id_externo;
  if found then
    return v_id;
  end if;

  -- Texto vazio: classificação 'para_ler' e, para o robô, texto não reconhecido.
  v_id := public.registrar_recebida(p_telefone, '', p_id_externo);

  update public.mensagens_recebidas r
  set midia_tipo = p_midia_tipo,
      midia_url_origem = p_midia_url_origem,
      midia_mime = left(nullif(btrim(p_midia_mime), ''), 200),
      midia_nome = left(nullif(btrim(p_midia_nome), ''), 255),
      midia_tamanho = case when p_midia_tamanho >= 0 then p_midia_tamanho end,
      midia_status = 'pendente',
      legenda = left(nullif(btrim(p_legenda), ''), 2000)
  where r.id = v_id and r.midia_tipo is null;

  return v_id;
end;
$$;

revoke execute on function public.registrar_recebida_midia(text, text, text, text, text, text, int, text)
  from public, anon, authenticated;
grant execute on function public.registrar_recebida_midia(text, text, text, text, text, text, int, text)
  to service_role;

-- =============================================================================
-- 3. gravar_midia_recebida
-- =============================================================================
create function public.gravar_midia_recebida(
  p_id uuid,
  p_status text,
  p_path text,
  p_mime text,
  p_tamanho int
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
begin
  if p_status is null or p_status not in ('salva', 'falhou', 'grande_demais') then
    raise exception 'Status de mídia inválido.' using errcode = 'P0001';
  end if;
  if p_status = 'salva' and (
    p_path is null
    or p_path !~ ('^\d{4}/\d{2}/' || p_id::text || '\.[a-z0-9]{1,10}$')
  ) then
    raise exception 'Caminho da mídia inválido.' using errcode = 'P0001';
  end if;

  select r.midia_status into v_status
  from public.mensagens_recebidas r
  where r.id = p_id
  for update;
  if not found or v_status is null then
    raise exception 'Mensagem sem mídia.' using errcode = 'P0001';
  end if;
  if v_status = 'salva' then
    return;
  end if;

  update public.mensagens_recebidas r
  set midia_status = p_status,
      midia_path = case when p_status = 'salva' then p_path end,
      midia_mime = coalesce(left(nullif(btrim(p_mime), ''), 200), r.midia_mime),
      midia_tamanho = coalesce(case when p_tamanho >= 0 then p_tamanho end, r.midia_tamanho)
  where r.id = p_id;
end;
$$;

revoke execute on function public.gravar_midia_recebida(uuid, text, text, text, int)
  from public, anon, authenticated;
grant execute on function public.gravar_midia_recebida(uuid, text, text, text, int) to service_role;

-- =============================================================================
-- 4. Storage: bucket privado `whatsapp-midia`
-- =============================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('whatsapp-midia', 'whatsapp-midia', false, 16777216, null)
on conflict (id) do nothing;

create policy whatsapp_midia_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'whatsapp-midia'
    and (select public.perfil_atual()) in ('dona', 'recepcao')
  );
