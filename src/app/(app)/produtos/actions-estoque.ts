"use server";

import { revalidatePath } from "next/cache";
import { mensagemErroBanco, type ErroBanco } from "@/lib/erros-db";
import { ERRO_INESPERADO, falha, OK, type Resultado } from "@/lib/resultado";
import { exigirPerfil } from "@/lib/sessao";
import { createClient } from "@/lib/supabase/server";
import {
  ajusteEstoqueSchema,
  entradaEstoqueSchema,
  type AjusteEstoqueInput,
  type EntradaEstoqueInput,
} from "./schemas";

// Estoque só muda por entrada_estoque e ajustar_estoque (security definer,
// só a dona). exigirPerfil redireciona lançando; por isso fica fora do try.

function erroDoBanco(error: ErroBanco): string {
  // entrada_estoque não confere o produto antes de inserir: vem da chave estrangeira.
  if (error.code === "23503") return "Produto não encontrado.";
  return mensagemErroBanco(error);
}

function revalidar() {
  revalidatePath("/produtos", "layout");
  // O Início mostra o alerta de estoque baixo.
  revalidatePath("/inicio");
}

/** Compra: soma ao estoque, atualiza o custo e, se pedido, lança a conta a pagar. */
export async function registrarEntrada(e: EntradaEstoqueInput): Promise<Resultado> {
  await exigirPerfil("dona");
  const lido = entradaEstoqueSchema.safeParse(e);
  if (!lido.success) return falha(lido.error.issues[0].message);
  const d = lido.data;
  try {
    const supabase = await createClient();
    const { error } = await supabase.rpc("entrada_estoque", {
      p_produto: d.produtoId,
      p_quantidade: d.quantidade,
      p_custo_unitario_centavos: d.custo,
      p_lancar_despesa: d.lancarDespesa,
      p_vencimento: d.vencimento,
      p_fornecedor: d.fornecedor,
    });
    if (error) return falha(erroDoBanco(error));
  } catch {
    return falha(ERRO_INESPERADO);
  }
  revalidar();
  return OK;
}

/** Contagem: grava a diferença entre a quantidade contada e o saldo atual. */
export async function ajustarEstoque(e: AjusteEstoqueInput): Promise<Resultado> {
  await exigirPerfil("dona");
  const lido = ajusteEstoqueSchema.safeParse(e);
  if (!lido.success) return falha(lido.error.issues[0].message);
  const d = lido.data;
  try {
    const supabase = await createClient();
    const { error } = await supabase.rpc("ajustar_estoque", {
      p_produto: d.produtoId,
      p_quantidade_contada: d.contada,
      p_motivo: d.motivo,
    });
    if (error) return falha(erroDoBanco(error));
  } catch {
    return falha(ERRO_INESPERADO);
  }
  revalidar();
  return OK;
}
