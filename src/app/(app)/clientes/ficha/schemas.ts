import { z } from "zod";
import { partesSchema, valorTextoSchema, descontoTextoSchema } from "@/app/(app)/caixa/schemas";
import { dataValida } from "@/features/agenda/grade";
import { MAX_SESSOES } from "@/lib/dominio/pacotes";
import { dataNoFuso } from "@/lib/dominio/tempo";

export const MENSAGEM_SESSOES = `Informe de 1 a ${MAX_SESSOES} sessões.`;
export const MENSAGEM_VALIDADE = "A validade não pode ser anterior a hoje.";

/** Venda de pacote: o total é o bruto; as partes fecham com total − desconto. */
export const vendaPacoteSchema = z.object({
  clienteId: z.uuid("Escolha a cliente."),
  servicoId: z.uuid("Escolha o serviço."),
  sessoes: z
    .number(MENSAGEM_SESSOES)
    .int(MENSAGEM_SESSOES)
    .min(1, MENSAGEM_SESSOES)
    .max(MAX_SESSOES, MENSAGEM_SESSOES),
  valorTotal: valorTextoSchema.refine((c) => c > 0, "O valor do pacote deve ser maior que zero."),
  validade: z
    .string()
    .nullable()
    .refine((v) => v === null || dataValida(v), "Validade inválida.")
    .refine((v) => v === null || !dataValida(v) || v >= dataNoFuso(new Date()), MENSAGEM_VALIDADE),
  desconto: descontoTextoSchema,
  partes: partesSchema,
});

export type VendaPacoteInput = z.input<typeof vendaPacoteSchema>;
