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
  estoqueAtual: quantidadeNaoNegativaSchema(MSG_ESTOQUE),
  estoqueMinimo: quantidadeNaoNegativaSchema(MSG_ESTOQUE),
});

export type ProdutoInput = z.input<typeof produtoSchema>;
