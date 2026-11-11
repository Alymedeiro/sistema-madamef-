"use server";

import { revalidatePath } from "next/cache";
import { mensagemErroBanco } from "@/lib/erros-db";
import { ERRO_INESPERADO, falha, OK, type Resultado } from "@/lib/resultado";
import { exigirPerfil } from "@/lib/sessao";
import { createClient } from "@/lib/supabase/server";
import { idSchema } from "@/lib/validacao";
import {
  categoriaSchema,
  produtosDoServicoSchema,
  servicoSchema,
  type CategoriaInput,
  type ProdutoDoServicoInput,
  type ServicoInput,
} from "./schemas";

// Toda escrita começa com exigirPerfil('dona'): recepção e profissional só
// consultam (o RLS também barra). exigirPerfil redireciona lançando; por isso
// fica fora dos try/catch.

const ERRO_CATEGORIA = "Categoria inválida.";
const ERRO_SERVICO = "Serviço inválido.";

export async function salvarCategoria(dados: CategoriaInput, id?: string): Promise<Resultado> {
  await exigirPerfil("dona");
  if (id !== undefined && !idSchema.safeParse(id).success) return falha(ERRO_CATEGORIA);

  const parsed = categoriaSchema.safeParse(dados);
  if (!parsed.success) return falha(parsed.error.issues[0].message);

  try {
    const supabase = await createClient();
    if (id === undefined) {
      const { error } = await supabase.from("categorias_servico").insert(parsed.data);
      if (error) return falha(mensagemDaCategoria(error));
    } else {
      const { data, error } = await supabase
        .from("categorias_servico")
        .update(parsed.data)
        .eq("id", id)
        .select("id");
      if (error) return falha(mensagemDaCategoria(error));
      if (!data?.length) return falha("Categoria não encontrada.");
    }
  } catch {
    return falha(ERRO_INESPERADO);
  }

  revalidatePath("/servicos", "layout");
  return OK;
}

function mensagemDaCategoria(erro: { code?: string; message?: string }): string {
  return erro.code === "23505"
    ? "Já existe uma categoria com este nome."
    : mensagemErroBanco(erro);
}

export async function salvarServico(dados: ServicoInput, id?: string): Promise<Resultado> {
  await exigirPerfil("dona");
  if (id !== undefined && !idSchema.safeParse(id).success) return falha(ERRO_SERVICO);

  const parsed = servicoSchema.safeParse(dados);
  if (!parsed.success) return falha(parsed.error.issues[0].message);
  const d = parsed.data;
  const linha = {
    nome: d.nome,
    categoria_id: d.categoriaId,
    descricao: d.descricao,
    duracao_min: d.duracaoMin,
    preco_centavos: d.precoCentavos,
    permite_online: d.permiteOnline,
    exige_avaliacao: d.exigeAvaliacao,
    dias_retorno: d.diasRetorno,
    modelo_termo_id: d.modeloTermoId,
  };

  try {
    const supabase = await createClient();
    let servicoId: string;
    if (id === undefined) {
      const { data, error } = await supabase.from("servicos").insert(linha).select("id").single();
      if (error || !data) return falha(error ? mensagemDoServico(error) : ERRO_INESPERADO);
      servicoId = data.id;
    } else {
      const { data, error } = await supabase
        .from("servicos")
        .update(linha)
        .eq("id", id)
        .select("id");
      if (error) return falha(mensagemDoServico(error));
      if (!data?.length) return falha("Serviço não encontrado.");
      servicoId = id;
    }

    // Comissão do serviço (só a dona lê e grava): vazio remove a linha e o
    // atendimento passa a usar a comissão padrão da profissional.
    if (d.comissaoPct !== undefined) {
      const { error } =
        d.comissaoPct === null
          ? await supabase.from("servicos_comissao").delete().eq("servico_id", servicoId)
          : await supabase
              .from("servicos_comissao")
              .upsert(
                { servico_id: servicoId, percentual: d.comissaoPct },
                { onConflict: "servico_id" },
              );
      if (error) {
        revalidatePath("/servicos", "layout");
        return falha(
          `O serviço foi salvo, mas não foi possível salvar a comissão. ${mensagemErroBanco(error)}`,
        );
      }
    }
  } catch {
    return falha(ERRO_INESPERADO);
  }

  revalidatePath("/servicos", "layout");
  return OK;
}

function mensagemDoServico(erro: { code?: string; message?: string }): string {
  return erro.code === "23503"
    ? "A categoria escolhida não existe mais. Atualize a página."
    : mensagemErroBanco(erro);
}

export async function definirServicoAtivo(id: string, ativo: boolean): Promise<Resultado> {
  await exigirPerfil("dona");
  if (!idSchema.safeParse(id).success) return falha(ERRO_SERVICO);

  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("servicos")
      .update({ ativo })
      .eq("id", id)
      .select("id");
    if (error) return falha(mensagemErroBanco(error));
    if (!data?.length) return falha("Serviço não encontrado.");
  } catch {
    return falha(ERRO_INESPERADO);
  }

  revalidatePath("/servicos", "layout");
  return OK;
}

/** Substitui a lista de produtos consumidos pelo serviço (quantidade por atendimento). */
export async function salvarProdutosDoServico(
  servicoId: string,
  itens: ProdutoDoServicoInput[],
): Promise<Resultado> {
  await exigirPerfil("dona");
  if (!idSchema.safeParse(servicoId).success) return falha(ERRO_SERVICO);

  const parsed = produtosDoServicoSchema.safeParse(itens);
  if (!parsed.success) return falha(parsed.error.issues[0].message);
  const desejados = new Map(parsed.data.map((i) => [i.produtoId, i.quantidade]));

  try {
    const supabase = await createClient();
    const { data: atuais, error: erroLista } = await supabase
      .from("servico_produtos")
      .select("id, produto_id, quantidade")
      .eq("servico_id", servicoId);
    if (erroLista) return falha(mensagemErroBanco(erroLista));

    const existentes = new Map((atuais ?? []).map((a) => [a.produto_id, Number(a.quantidade)]));
    const gravar = parsed.data
      .filter((i) => existentes.get(i.produtoId) !== i.quantidade)
      .map((i) => ({ servico_id: servicoId, produto_id: i.produtoId, quantidade: i.quantidade }));
    const remover = (atuais ?? []).filter((a) => !desejados.has(a.produto_id)).map((a) => a.id);

    // Grava antes de apagar: se algo falhar no meio, o que existia continua.
    if (gravar.length > 0) {
      const { error } = await supabase
        .from("servico_produtos")
        .upsert(gravar, { onConflict: "servico_id,produto_id" });
      if (error) return falha(mensagemErroBanco(error));
    }
    if (remover.length > 0) {
      const { error } = await supabase.from("servico_produtos").delete().in("id", remover);
      if (error) return falha(mensagemErroBanco(error));
    }
  } catch {
    return falha(ERRO_INESPERADO);
  }

  revalidatePath("/servicos", "layout");
  return OK;
}
