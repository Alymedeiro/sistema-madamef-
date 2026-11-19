-- =============================================================================
-- 0021_excluir_servico — excluir de vez um serviço que nunca foi usado.
--
--   excluir_servico(p_id): só a dona. Recusa (P0001) quando o serviço tem
--   histórico: agendamentos, pacotes vendidos, pedidos online, comissões ou
--   fotos de ficha. Nesse caso o caminho continua sendo "Desativar".
--   Sem histórico: tira o serviço dos leads (servico_id = null), apaga as
--   fotos do catálogo e o serviço (vínculos com profissionais, produtos
--   consumidos e percentual de comissão saem em cascata). Devolve os caminhos
--   das fotos para o app apagar os arquivos no Storage.
--   Exceção aceita à regra "nada é apagado": serviço sem nenhum uso é só
--   configuração da dona (ex.: cadastrado por engano).
-- =============================================================================
set lock_timeout = '5s';

create function public.excluir_servico(p_id uuid)
returns text[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caminhos text[];
begin
  if public.perfil_atual() is distinct from 'dona' then
    raise exception 'Apenas a dona pode excluir serviços.' using errcode = 'P0001';
  end if;

  perform 1 from public.servicos s where s.id = p_id for update;
  if not found then
    raise exception 'Serviço não encontrado.' using errcode = 'P0001';
  end if;

  if exists (select 1 from public.agendamentos a where a.servico_id = p_id)
     or exists (select 1 from public.pacotes_vendidos p where p.servico_id = p_id)
     or exists (select 1 from public.pedidos_online p where p.servico_id = p_id)
     or exists (select 1 from public.comissoes c where c.servico_id = p_id)
     or exists (select 1 from public.fotos f where f.servico_id = p_id) then
    raise exception 'Este serviço já tem histórico (agendamentos, pacotes ou pedidos) e não pode ser excluído. Use "Desativar" para tirá-lo das listas.'
      using errcode = 'P0001';
  end if;

  update public.leads set servico_id = null where servico_id = p_id;

  select coalesce(array_agg(f.caminho), '{}') into v_caminhos
  from public.servicos_fotos f where f.servico_id = p_id;
  delete from public.servicos_fotos f where f.servico_id = p_id;

  delete from public.servicos s where s.id = p_id;
  return v_caminhos;
end
$$;

revoke execute on function public.excluir_servico(uuid) from public, anon;
grant execute on function public.excluir_servico(uuid) to authenticated, service_role;
