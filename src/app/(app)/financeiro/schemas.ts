import { z } from "zod";
import { dataValida } from "@/features/agenda/grade";
import { parseBRL } from "@/lib/dominio/dinheiro";
import { CATEGORIAS_CONTA, FORMAS_SAIDA } from "@/lib/dominio/financeiro";
import { idSchema, MENSAGEM_VALOR_INVALIDO, textoOpcional } from "@/lib/validacao";

const LIMITE_CENTAVOS = 2_000_000_000;

/** Formato do caminho no bucket `financeiro` (o mesmo check do banco). */
export const ANEXO_PATH = /^contas_pagar\/[0-9a-f-]{36}\.(jpg|png|pdf)$/;

/** "1.234,56" → 123456; precisa ser maior que zero. */
export const valorPositivoSchema = z.string(MENSAGEM_VALOR_INVALIDO).transform((v, ctx) => {
  const c = parseBRL(v);
  if (c === null || c > LIMITE_CENTAVOS) {
    ctx.addIssue({ code: "custom", message: MENSAGEM_VALOR_INVALIDO });
    return z.NEVER;
  }
  if (c <= 0) {
    ctx.addIssue({ code: "custom", message: "Informe um valor maior que zero." });
    return z.NEVER;
  }
  return c;
});

export const dataSchema = z
  .string("Informe uma data válida.")
  .refine((v) => dataValida(v), "Informe uma data válida.");

const descricaoSchema = z
  .string("Informe a descrição.")
  .trim()
  .min(1, "Informe a descrição.")
  .max(120, "A descrição pode ter até 120 caracteres.");

const categoriaSchema = z.enum(
  CATEGORIAS_CONTA as unknown as [string, ...string[]],
  "Escolha a categoria.",
) as unknown as z.ZodType<(typeof CATEGORIAS_CONTA)[number]>;

const formaSchema = z.enum(FORMAS_SAIDA, "Escolha a forma de pagamento.");

const camposConta = {
  descricao: descricaoSchema,
  categoria: categoriaSchema,
  fornecedor: textoOpcional(120, "O fornecedor pode ter até 120 caracteres.").nullish().transform(
    (v) => v ?? null,
  ),
  valor: valorPositivoSchema,
};

export const contaPagarSchema = z.object({
  ...camposConta,
  vencimento: dataSchema,
  anexoPath: z
    .string()
    .regex(ANEXO_PATH, "Anexo inválido. Envie o arquivo de novo.")
    .nullish()
    .transform((v) => v ?? null),
});

export const editarContaPagarSchema = contaPagarSchema.extend({ contaId: idSchema });

export const pagarContaSchema = z.object({
  contaId: idSchema,
  pagoEm: dataSchema,
  forma: formaSchema,
});

export const cancelarContaSchema = z.object({
  tipo: z.enum(["pagar", "receber"]),
  contaId: idSchema,
  motivo: z
    .string("Informe o motivo do cancelamento.")
    .trim()
    .min(1, "Informe o motivo do cancelamento.")
    .max(200, "O motivo pode ter até 200 caracteres."),
});

export const valeSchema = z.object({
  colaboradorId: z.uuid("Escolha a colaboradora."),
  valor: valorPositivoSchema,
  data: dataSchema,
  forma: formaSchema,
  obs: textoOpcional(80, "A observação pode ter até 80 caracteres."),
});

export const contaFixaSchema = z.object({
  ...camposConta,
  dia: z
    .number("Escolha um dia de 1 a 31.")
    .int("Escolha um dia de 1 a 31.")
    .min(1, "Escolha um dia de 1 a 31.")
    .max(31, "Escolha um dia de 1 a 31."),
  inicio: dataSchema,
});

export const receberParcelaSchema = z.object({
  contaId: idSchema,
  forma: formaSchema,
});

/** Conta a receber manual (parcela 1/1, sem pagamento). */
export const contaReceberSchema = z.object({
  clienteId: z.uuid("Escolha a cliente."),
  descricao: descricaoSchema,
  valor: valorPositivoSchema,
  vencimento: dataSchema,
});

export type ContaPagarInput = z.input<typeof contaPagarSchema>;
export type EditarContaPagarInput = z.input<typeof editarContaPagarSchema>;
export type PagarContaInput = z.input<typeof pagarContaSchema>;
export type CancelarContaInput = z.input<typeof cancelarContaSchema>;
export type ValeInput = z.input<typeof valeSchema>;
export type ContaFixaInput = z.input<typeof contaFixaSchema>;
export type ReceberParcelaInput = z.input<typeof receberParcelaSchema>;
export type ContaReceberInput = z.input<typeof contaReceberSchema>;
