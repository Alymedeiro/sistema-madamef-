import { z } from "zod";
import { normalizarWhatsApp } from "@/lib/dominio/telefone";

/** Texto opcional: vazio/ausente vira null; senão, aparado. */
export const textoOpcional = (max: number, mensagemMax: string) =>
  z
    .string()
    .trim()
    .max(max, mensagemMax)
    .optional()
    .transform((v) => (v ? v : null));

/** Telefone opcional: vazio vira null; informado precisa virar 55 + DDD + número. */
export const telefoneOpcional = z
  .string()
  .trim()
  .optional()
  .transform((v, ctx) => {
    if (!v) return null;
    const normalizado = normalizarWhatsApp(v);
    if (!normalizado) {
      ctx.addIssue({
        code: "custom",
        message: "Telefone inválido. Informe DDD e número, por exemplo (11) 98765-4321.",
      });
      return z.NEVER;
    }
    return normalizado;
  });
