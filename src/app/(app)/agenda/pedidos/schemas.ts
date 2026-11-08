import { z } from "zod";
import { dataSchema, horaSchema } from "@/app/(app)/agenda/schemas";
import { normalizarWhatsApp } from "@/lib/dominio/telefone";
import { idSchema, textoOpcional } from "@/lib/validacao";

export const MSG_ESCOLHA_CLIENTE = "Escolha a cliente ou cadastre uma nova.";

const novaClienteSchema = z.object({
  nome: z
    .string()
    .trim()
    .min(1, "Informe o nome da cliente.")
    .max(120, "O nome pode ter no máximo 120 caracteres.")
    .transform((v) => v.replace(/\s+/g, " ")),
  whatsapp: z.string().transform((v, ctx) => {
    const n = normalizarWhatsApp(v);
    if (!n) {
      ctx.addIssue({ code: "custom", message: "Informe o WhatsApp com DDD" });
      return z.NEVER;
    }
    return n;
  }),
});

export const aprovacaoSchema = z
  .object({
    pedidoId: idSchema,
    clienteId: z.uuid(MSG_ESCOLHA_CLIENTE).nullable(),
    novaCliente: novaClienteSchema.optional(),
    profissionalId: z.uuid("Escolha a profissional."),
    data: dataSchema,
    hora: horaSchema,
    forcarForaJornada: z.boolean().optional().default(false),
  })
  .refine((d) => d.clienteId !== null || d.novaCliente !== undefined, MSG_ESCOLHA_CLIENTE);

export type AprovacaoInput = z.input<typeof aprovacaoSchema>;

export const recusaSchema = z.object({
  pedidoId: idSchema,
  motivo: textoOpcional(200, "O motivo pode ter no máximo 200 caracteres."),
});

export type RecusaInput = z.input<typeof recusaSchema>;
