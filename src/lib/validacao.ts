import { z } from "zod";
import { temNoMaximoCasas } from "@/lib/dominio/catalogo";
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

/** Mensagem única para campo de dinheiro digitado que não vira centavos. */
export const MENSAGEM_VALOR_INVALIDO = "Informe um valor válido, ex.: 150,00";

/** Centavos: inteiro >= 0. */
export const centavosSchema = z
  .number(MENSAGEM_VALOR_INVALIDO)
  .int(MENSAGEM_VALOR_INVALIDO)
  .min(0, MENSAGEM_VALOR_INVALIDO)
  .max(2_000_000_000, MENSAGEM_VALOR_INVALIDO);

/** Quantidade fracionada (numeric(12,3)): >= 0, até 3 casas, limite razoável. */
export const quantidadeNaoNegativaSchema = (mensagem: string) =>
  z
    .number(mensagem)
    .min(0, mensagem)
    .max(999_999, mensagem)
    .refine((n) => temNoMaximoCasas(n, 3), mensagem);

/** Identificador de registro vindo do cliente (Server Actions não confiam no argumento). */
export const idSchema = z.uuid("Registro inválido.");
