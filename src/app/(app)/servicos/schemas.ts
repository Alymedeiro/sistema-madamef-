import { z } from "zod";
import {
  centavosSchema,
  percentualOpcionalSchema,
  quantidadeNaoNegativaSchema,
  textoOpcional,
} from "@/lib/validacao";

export const categoriaSchema = z.object({
  nome: z
    .string()
    .trim()
    .min(1, "Informe o nome da categoria.")
    .max(80, "O nome pode ter no máximo 80 caracteres."),
});

export type CategoriaInput = z.input<typeof categoriaSchema>;

const MSG_DURACAO = "A duração deve ser de 5 a 480 minutos, em múltiplos de 5.";

export const servicoSchema = z.object({
  nome: z
    .string()
    .trim()
    .min(1, "Informe o nome do serviço.")
    .max(120, "O nome pode ter no máximo 120 caracteres."),
  categoriaId: z.uuid("Escolha a categoria."),
  descricao: textoOpcional(500, "A descrição pode ter no máximo 500 caracteres."),
  duracaoMin: z
    .number(MSG_DURACAO)
    .int(MSG_DURACAO)
    .min(5, MSG_DURACAO)
    .max(480, MSG_DURACAO)
    .refine((n) => n % 5 === 0, MSG_DURACAO),
  precoCentavos: centavosSchema,
  permiteOnline: z.boolean(),
  // Com permiteOnline, na Fase 3 vira "Agendar avaliação"; aqui os dois combinam.
  exigeAvaliacao: z.boolean(),
  diasRetorno: z
    .number("Informe os dias para retorno em número inteiro, a partir de 1.")
    .int("Informe os dias para retorno em número inteiro, a partir de 1.")
    .min(1, "Informe os dias para retorno em número inteiro, a partir de 1.")
    .max(3650, "O retorno pode ter no máximo 3650 dias.")
    .nullish()
    .transform((v) => v ?? null),
  // Termo de consentimento exigido pelo serviço ("" ou ausente = nenhum).
  modeloTermoId: z
    .union([z.literal(""), z.uuid("Escolha um termo válido."), z.null()])
    .optional()
    .transform((v) => v || null),
  /** "12,5" → 12.5; vazio = null (usa a padrão da profissional). Só a dona grava. */
  comissaoPct: percentualOpcionalSchema,
});

export type ServicoInput = z.input<typeof servicoSchema>;

const MSG_QUANTIDADE = "Informe uma quantidade maior que zero, com até 3 casas decimais.";

export const produtoDoServicoSchema = z.object({
  produtoId: z.uuid("Escolha o produto."),
  quantidade: quantidadeNaoNegativaSchema(MSG_QUANTIDADE).refine((n) => n > 0, MSG_QUANTIDADE),
});

export type ProdutoDoServicoInput = z.input<typeof produtoDoServicoSchema>;

export const produtosDoServicoSchema = z
  .array(produtoDoServicoSchema)
  .superRefine((itens, ctx) => {
    const vistos = new Set<string>();
    for (const item of itens) {
      if (vistos.has(item.produtoId)) {
        ctx.addIssue({ code: "custom", message: "Um produto não pode aparecer mais de uma vez." });
        return;
      }
      vistos.add(item.produtoId);
    }
  });
