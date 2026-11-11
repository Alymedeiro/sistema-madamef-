import { z } from "zod";
import { centavosSchema, quantidadeNaoNegativaSchema } from "@/lib/validacao";

const MSG_ESTOQUE = "Informe uma quantidade válida, a partir de 0, com até 3 casas decimais.";

export const produtoSchema = z.object({
  nome: z
    .string()
    .trim()
    .min(1, "Informe o nome do produto.")
    .max(120, "O nome pode ter no máximo 120 caracteres."),
  unidade: z
    .string()
    .trim()
    .min(1, "Informe a unidade (ex.: un, ml, g).")
    .max(20, "A unidade pode ter no máximo 20 caracteres."),
  precoVendaCentavos: centavosSchema.nullish().transform((v) => v ?? null),
  /** Custo unitário: gravado em produtos_custos, que só a dona enxerga (R10). */
  custoCentavos: centavosSchema,
  estoqueMinimo: quantidadeNaoNegativaSchema(MSG_ESTOQUE),
});

/**
 * Na criação, o estoque inicial entra como ajuste (motivo "Estoque inicial");
 * depois disso o estoque só muda por entrada ou ajuste, nunca pelo cadastro.
 */
export const produtoNovoSchema = produtoSchema.extend({
  estoqueInicial: quantidadeNaoNegativaSchema(MSG_ESTOQUE).optional().transform((v) => v ?? 0),
});

export type ProdutoInput = z.input<typeof produtoSchema>;
export type ProdutoNovoInput = z.input<typeof produtoNovoSchema>;
