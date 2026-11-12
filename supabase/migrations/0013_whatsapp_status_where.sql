-- =============================================================================
-- 0013_whatsapp_status_where — gravar_status_whatsapp com WHERE
--
-- No Supabase, o pg_safeupdate recusa UPDATE sem WHERE em chamadas pela API
-- ("UPDATE requires a WHERE clause"), e o status da conexão nunca era gravado.
-- Mesma assinatura e grants de 0012; a tabela tem uma linha só (linha_unica).
-- =============================================================================
create or replace function public.gravar_status_whatsapp(p_estado text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.whatsapp_status
  set estado = p_estado, verificado_em = now()
  where linha_unica;
$$;

revoke execute on function public.gravar_status_whatsapp(text) from public, anon, authenticated;
grant execute on function public.gravar_status_whatsapp(text) to service_role;
