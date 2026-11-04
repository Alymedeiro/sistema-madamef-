"use server";

import { revalidatePath } from "next/cache";
import { mensagemErroBanco } from "@/lib/erros-db";
import { ERRO_INESPERADO, falha, OK, type Resultado } from "@/lib/resultado";
import { exigirPerfil } from "@/lib/sessao";
import { createClient } from "@/lib/supabase/server";
import { idSchema } from "@/lib/validacao";
import { produtoSchema, type ProdutoInput } from "./schemas";

// Toda escrita começa com exigirPerfil('dona'). exigirPerfil redireciona
// lançando; por isso fica fora dos try/catch.

const ERRO_PRODUTO = "Produto inválido.";

export async function salvarProduto(dados: ProdutoInput, id?: string): Promise<Resultado> {
  const sessao = await exigirPerfil("dona");
  if (id !== undefined && !idSchema.safeParse(id).success) return falha(ERRO_PRODUTO);

  const parsed = produtoSchema.safeParse(dados);
  if (!parsed.success) return falha(parsed.error.issues[0].message);
  const d = parsed.data;
  const linha = {
    nome: d.nome,
    unidade: d.unidade,
    preco_venda_centavos: d.precoVendaCentavos,
    estoque_atual: d.estoqueAtual,
    estoque_minimo: d.estoqueMinimo,
  };

  try {
    const supabase = await createClient();

    let produtoId: string;
    if (id === undefined) {
      const { data, error } = await supabase.from("produtos").insert(linha).select("id").single();
      if (error || !data) return falha(error ? mensagemErroBanco(error) : ERRO_INESPERADO);
      produtoId = data.id;
    } else {
      const { data, error } = await supabase
        .from("produtos")
        .update(linha)
        .eq("id", id)
        .select("id");
      if (error) return falha(mensagemErroBanco(error));
      if (!data?.length) return falha("Produto não encontrado.");
      produtoId = id;
    }

    // Custo mora em produtos_custos (R10): só a dona lê e grava.
    if (sessao.colaborador.perfil === "dona") {
      const { error } = await supabase
        .from("produtos_custos")
        .upsert(
          { produto_id: produtoId, custo_unitario_centavos: d.custoCentavos },
          { onConflict: "produto_id" },
        );
      if (error) {
        return falha(
          `O produto foi salvo, mas não foi possível salvar o custo. ${mensagemErroBanco(error)}`,
        );
      }
    }
  } catch {
    return falha(ERRO_INESPERADO);
  }

  revalidatePath("/produtos", "layout");
  revalidatePath("/servicos", "layout");
  return OK;
}

export async function definirProdutoAtivo(id: string, ativo: boolean): Promise<Resultado> {
  await exigirPerfil("dona");
  if (!idSchema.safeParse(id).success) return falha(ERRO_PRODUTO);

  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("produtos")
      .update({ ativo })
      .eq("id", id)
      .select("id");
    if (error) return falha(mensagemErroBanco(error));
    if (!data?.length) return falha("Produto não encontrado.");
  } catch {
    return falha(ERRO_INESPERADO);
  }

  revalidatePath("/produtos", "layout");
  revalidatePath("/servicos", "layout");
  return OK;
}
