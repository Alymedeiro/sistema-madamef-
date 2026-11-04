import { dataValida } from "@/features/agenda/grade";
import { FORMAS_PAGAMENTO, formaParcelada, MAX_PARCELAS } from "@/lib/dominio/caixa";
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

export const pagamentoSchema = z
  .object({
    // Informado pela tela, mas a action usa a cliente do agendamento.
    clienteId: z.string().optional(),
    agendamentoId: idSchema,
    forma: z.enum(FORMAS_PAGAMENTO as [string, ...string[]], "Escolha a forma de pagamento.") as z.ZodType<
      (typeof FORMAS_PAGAMENTO)[number]
    >,
    valor: valorTextoSchema,
    desconto: z.string(MENSAGEM_VALOR_INVALIDO).transform((v, ctx) => {
      const c = dinheiro(v, 0);
      if (c === null) {
        ctx.addIssue({ code: "custom", message: MENSAGEM_VALOR_INVALIDO });
        return z.NEVER;
      }
      return c;
    }),
    parcelas: z.number("Número de parcelas inválido.").int("Número de parcelas inválido."),
    primeiroVencimento: z.string().optional(),
  })
  .superRefine((d, ctx) => {
    if (d.valor <= 0) {
      ctx.addIssue({ code: "custom", path: ["valor"], message: "O valor deve ser maior que zero." });
    }
    if (d.desconto > d.valor) {
      ctx.addIssue({
        code: "custom",
        path: ["desconto"],
        message: "O desconto não pode ser maior que o valor.",
      });
    }
    if (formaParcelada(d.forma) && (d.parcelas < 2 || d.parcelas > MAX_PARCELAS)) {
      ctx.addIssue({
        code: "custom",
        path: ["parcelas"],
        message: `Informe de 2 a ${MAX_PARCELAS} parcelas.`,
      });
    }
    if (d.forma === "a_receber") {
      if (!d.primeiroVencimento || !dataValida(d.primeiroVencimento)) {
        ctx.addIssue({
          code: "custom",
          path: ["primeiroVencimento"],
          message: "Informe o primeiro vencimento.",
        });
      } else if (d.primeiroVencimento < dataNoFuso(new Date())) {
        ctx.addIssue({
          code: "custom",
          path: ["primeiroVencimento"],
          message: "O primeiro vencimento não pode ser anterior a hoje.",
        });
      }
    }
  });

export type PagamentoInput = z.input<typeof pagamentoSchema>;
