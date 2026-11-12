-- =============================================================================
-- 0016_robo_tipos — robô de atendimento: tipo novo de mensagem
--
-- Separada de 0017 porque um valor novo de enum não pode ser usado na mesma
-- transação em que é criado (restrição, funções e gatilhos de 0017 usam
-- 'robo'). Nada aqui usa o valor.
-- =============================================================================

alter type public.tipo_mensagem add value if not exists 'robo';
