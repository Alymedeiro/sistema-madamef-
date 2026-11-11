import { z } from "zod";
import { idSchema } from "@/lib/validacao";

export const LIMITE_TEXTO_AVULSA = 1000;

/** Mesma mensagem do banco (enviar_avulsa), para recusar antes de chamar a RPC. */
export const MENSAGEM_TEXTO_VAZIO = "Escreva a mensagem.";

export const envioSchema = z.object({
  clienteId: idSchema,
  texto: z
    .string()
    .trim()
    .min(1, MENSAGEM_TEXTO_VAZIO)
    .max(LIMITE_TEXTO_AVULSA, `A mensagem pode ter até ${LIMITE_TEXTO_AVULSA} caracteres.`),
  agendamentoId: idSchema.nullish(),
});
export type EnvioInput = z.input<typeof envioSchema>;

export const cancelamentoSchema = z.object({
  id: idSchema,
  motivo: z.string().trim().max(200, "O motivo pode ter até 200 caracteres.").optional(),
});
export type CancelamentoInput = z.input<typeof cancelamentoSchema>;
