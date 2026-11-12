import { z } from "zod";
import { ETAPAS_LEAD, type EtapaLead } from "@/lib/dominio/crm";
import { normalizarWhatsApp } from "@/lib/dominio/telefone";
import { idSchema } from "@/lib/validacao";
import { LIMITE_TEXTO_AVULSA, MENSAGEM_TEXTO_VAZIO } from "../mensagens/schemas";

export const LIMITE_LOTE_REATIVACAO = 500;

/** Mesmas mensagens do banco (enviar_reativacao), para recusar antes da RPC. */
export const reativacaoSchema = z
  .array(idSchema)
  .min(1, "Escolha pelo menos uma cliente.")
  .max(LIMITE_LOTE_REATIVACAO, `Escolha no máximo ${LIMITE_LOTE_REATIVACAO} clientes.`)
  .transform((ids) => [...new Set(ids)]);

const idOpcional = z
  .union([z.literal(""), idSchema])
  .optional()
  .transform((v) => (v ? v : null));

const textoOuNulo = (max: number, mensagem: string) =>
  z
    .string()
    .trim()
    .max(max, mensagem)
    .optional()
    .transform((v) => (v ? v : null));

export const MENSAGEM_WHATSAPP_INVALIDO = "Informe um WhatsApp válido.";

export const leadSchema = z.object({
  nome: z
    .string()
    .trim()
    .min(1, "Informe o nome do lead.")
    .max(120, "O nome pode ter no máximo 120 caracteres."),
  whatsapp: z
    .string()
    .trim()
    .optional()
    .transform((v, ctx) => {
      if (!v) return null;
      const normalizado = normalizarWhatsApp(v);
      if (!normalizado) {
        ctx.addIssue({ code: "custom", message: MENSAGEM_WHATSAPP_INVALIDO });
        return z.NEVER;
      }
      return normalizado;
    }),
  servicoId: idOpcional,
  origem: textoOuNulo(80, "A origem pode ter no máximo 80 caracteres."),
  responsavelId: idOpcional,
  observacoes: textoOuNulo(2000, "As observações podem ter no máximo 2000 caracteres."),
});
export type LeadInput = z.input<typeof leadSchema>;

export const LIMITE_MOTIVO_PERDA = 200;

export const moverLeadSchema = z.object({
  id: idSchema,
  etapa: z.enum(ETAPAS_LEAD as [EtapaLead, ...EtapaLead[]], "Etapa inválida."),
  motivo: z
    .string()
    .trim()
    .max(LIMITE_MOTIVO_PERDA, `O motivo pode ter no máximo ${LIMITE_MOTIVO_PERDA} caracteres.`)
    .optional(),
});
export type MoverLeadInput = z.input<typeof moverLeadSchema>;

export const MENSAGEM_ACEITE_LGPD = "Confirme o aceite da LGPD.";

export const converterLeadSchema = z.object({
  id: idSchema,
  aceiteLgpd: z.boolean().refine((v) => v, MENSAGEM_ACEITE_LGPD),
  aceitaMarketing: z.boolean(),
});
export type ConverterLeadInput = z.input<typeof converterLeadSchema>;

export const whatsappLeadSchema = z.object({
  id: idSchema,
  texto: z
    .string()
    .trim()
    .min(1, MENSAGEM_TEXTO_VAZIO)
    .max(LIMITE_TEXTO_AVULSA, `A mensagem pode ter até ${LIMITE_TEXTO_AVULSA} caracteres.`),
});
export type WhatsappLeadInput = z.input<typeof whatsappLeadSchema>;
