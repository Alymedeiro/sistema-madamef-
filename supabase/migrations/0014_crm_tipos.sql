-- =============================================================================
-- 0014_crm_tipos — Fase 5 (CRM): tipos novos de mensagem
--
-- Separada de 0015 porque um valor novo de enum não pode ser usado na mesma
-- transação em que é criado (modelos, índice parcial e funções de 0015 usam
-- 'retorno' e 'reativacao'). Nada aqui usa os valores.
-- =============================================================================

alter type public.tipo_mensagem add value if not exists 'retorno';
alter type public.tipo_mensagem add value if not exists 'reativacao';
