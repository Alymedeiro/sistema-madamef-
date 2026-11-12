import { z } from "zod";
import { idSchema } from "@/lib/validacao";

export const LIMITE_LOTE_REATIVACAO = 500;

/** Mesmas mensagens do banco (enviar_reativacao), para recusar antes da RPC. */
export const reativacaoSchema = z
  .array(idSchema)
  .min(1, "Escolha pelo menos uma cliente.")
  .max(LIMITE_LOTE_REATIVACAO, `Escolha no máximo ${LIMITE_LOTE_REATIVACAO} clientes.`)
  .transform((ids) => [...new Set(ids)]);
