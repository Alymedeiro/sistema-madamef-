import { z } from "zod";
import { dataValida } from "@/features/agenda/grade";
import { parseQuantidade, temNoMaximoCasas } from "@/lib/dominio/catalogo";
import { parseBRL } from "@/lib/dominio/dinheiro";
import {
  centavosSchema,
  idSchema,
  MENSAGEM_VALOR_INVALIDO,
  quantidadeNaoNegativaSchema,
  textoOpcional,
} from "@/lib/validacao";

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

// ---------------------------------------------------------------------------
// Aba Estoque (dona): entrada e ajuste. Campos chegam como texto pt-BR.
// ---------------------------------------------------------------------------

const MSG_QUANTIDADE = "Informe uma quantidade válida, com até 3 casas decimais.";
const LIMITE_QUANTIDADE = 999_999;
const LIMITE_CENTAVOS = 2_000_000_000;

/** "1,5" → 1.5 (até 3 casas, ≥ 0). Negativo tem mensagem própria. */
const quantidadeDeTexto = (msgNegativa: string) =>
  z.string(MSG_QUANTIDADE).transform((v, ctx) => {
    const t = v.trim();
    if (t.startsWith("-")) {
      ctx.addIssue({ code: "custom", message: msgNegativa });
      return z.NEVER;
    }
    const n = parseQuantidade(t);
    if (n === null || n > LIMITE_QUANTIDADE || !temNoMaximoCasas(n, 3)) {
      ctx.addIssue({ code: "custom", message: MSG_QUANTIDADE });
      return z.NEVER;
    }
    return Math.round(n * 1000) / 1000;
  });

/** "12,50" → 1250 centavos (≥ 0). */
const custoDeTexto = z.string(MENSAGEM_VALOR_INVALIDO).transform((v, ctx) => {
  const c = parseBRL(v);
  if (c === null || c > LIMITE_CENTAVOS) {
    ctx.addIssue({ code: "custom", message: MENSAGEM_VALOR_INVALIDO });
    return z.NEVER;
  }
  return c;
});

const MSG_ZERO = "A quantidade deve ser maior que zero.";

export const entradaEstoqueSchema = z
  .object({
    produtoId: idSchema,
    quantidade: quantidadeDeTexto(MSG_ZERO).refine((n) => n > 0, MSG_ZERO),
    custo: custoDeTexto,
    lancarDespesa: z.boolean(),
    vencimento: z.string().optional(),
    fornecedor: textoOpcional(120, "O fornecedor pode ter até 120 caracteres."),
  })
  .superRefine((d, ctx) => {
    if (d.lancarDespesa && !(d.vencimento && dataValida(d.vencimento))) {
      ctx.addIssue({ code: "custom", path: ["vencimento"], message: "Informe o vencimento." });
    }
    if (Math.round(d.quantidade * d.custo) > LIMITE_CENTAVOS) {
      ctx.addIssue({ code: "custom", path: ["custo"], message: "O total da compra passou do limite." });
    }
  })
  .transform((d) => ({
    ...d,
    // Sem despesa, vencimento e fornecedor não têm onde entrar.
    vencimento: d.lancarDespesa ? (d.vencimento as string) : null,
    fornecedor: d.lancarDespesa ? d.fornecedor : null,
  }));

export const ajusteEstoqueSchema = z.object({
  produtoId: idSchema,
  contada: quantidadeDeTexto("A quantidade contada não pode ser negativa."),
  motivo: z
    .string("Informe o motivo do ajuste.")
    .trim()
    .min(1, "Informe o motivo do ajuste.")
    .max(200, "O motivo pode ter até 200 caracteres."),
});

export type EntradaEstoqueInput = z.input<typeof entradaEstoqueSchema>;
export type AjusteEstoqueInput = z.input<typeof ajusteEstoqueSchema>;
