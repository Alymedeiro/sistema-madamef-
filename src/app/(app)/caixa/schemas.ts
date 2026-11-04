import { dataValida } from "@/features/agenda/grade";
import { FORMAS_PAGAMENTO, formaParcelada, type FormaPagamento } from "@/lib/dominio/caixa";
import type { ParteCobranca } from "@/lib/dominio/cobranca";
import { parseBRL } from "@/lib/dominio/dinheiro";
import { dataNoFuso } from "@/lib/dominio/tempo";
import { idSchema, MENSAGEM_VALOR_INVALIDO } from "@/lib/validacao";
import { z } from "zod";

const LIMITE_CENTAVOS = 2_000_000_000;

/** Texto em formato brasileiro -> centavos; vazio só vale quando `vazio` é informado. */
function dinheiro(texto: string, vazio?: number): number | null {
  if (texto.trim() === "" && vazio !== undefined) return vazio;
  const c = parseBRL(texto);
  return c === null || c > LIMITE_CENTAVOS ? null : c;
}

export const valorTextoSchema = z
  .string(MENSAGEM_VALOR_INVALIDO)
  .transform((v, ctx) => {
    const c = dinheiro(v);
    if (c === null) {
      ctx.addIssue({ code: "custom", message: MENSAGEM_VALOR_INVALIDO });
      return z.NEVER;
    }
    return c;
  });

/** Desconto em texto; vazio vale 0. */
export const descontoTextoSchema = z.string(MENSAGEM_VALOR_INVALIDO).transform((v, ctx) => {
  const c = dinheiro(v, 0);
  if (c === null) {
    ctx.addIssue({ code: "custom", message: MENSAGEM_VALOR_INVALIDO });
    return z.NEVER;
  }
  return c;
});

const parteSchema = z
  .object({
    forma: z.enum(FORMAS_PAGAMENTO as [string, ...string[]], "Escolha a forma de pagamento.") as z.ZodType<
      FormaPagamento
    >,
    valor: valorTextoSchema,
    parcelas: z.number("Número de parcelas inválido.").int("Número de parcelas inválido."),
    primeiroVencimento: z.string().optional(),
  })
  .superRefine((p, ctx) => {
    // Vencimento ausente ou inválido é tratado por erroDasPartes.
    if (
      p.forma === "a_receber" &&
      p.primeiroVencimento &&
      dataValida(p.primeiroVencimento) &&
      p.primeiroVencimento < dataNoFuso(new Date())
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["primeiroVencimento"],
        message: "O primeiro vencimento não pode ser anterior a hoje.",
      });
    }
  })
  .transform(
    (p): ParteCobranca => ({
      forma: p.forma,
      valorCentavos: p.valor,
      parcelas: formaParcelada(p.forma) ? p.parcelas : 1,
      ...(p.forma === "a_receber" ? { primeiroVencimento: p.primeiroVencimento } : {}),
    }),
  );

/**
 * Partes digitadas na tela (valores em texto) → ParteCobranca[]. Quantidade,
 * valor > 0, parcelas e soma ficam com erroDasPartes, que conhece o líquido.
 * Reutilizado pela venda de pacote.
 */
export const partesSchema = z.array(parteSchema, "Informe as formas de pagamento.");

export const cobrancaSchema = z.object({
  agendamentoId: idSchema,
  desconto: descontoTextoSchema,
  partes: partesSchema,
});

export type CobrancaInput = z.input<typeof cobrancaSchema>;
