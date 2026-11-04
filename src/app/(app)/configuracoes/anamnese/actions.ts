"use server";

import { revalidatePath } from "next/cache";
import {
  erroDasPerguntas,
  precisaNovaVersao,
  type Pergunta,
} from "@/lib/dominio/anamnese";
import { mensagemErroBanco } from "@/lib/erros-db";
import { ERRO_INESPERADO, falha, OK, type Resultado } from "@/lib/resultado";
import { exigirPerfil } from "@/lib/sessao";
import { createClient } from "@/lib/supabase/server";

export async function salvarModeloAnamnese(dados: {
  titulo: string;
  perguntas: Pergunta[];
}): Promise<Resultado> {
  await exigirPerfil("dona");

  const titulo = String(dados.titulo ?? "").trim();
  if (!titulo) return falha("Informe o título do modelo.");
  const perguntas = dados.perguntas.map((p) => ({
    id: p.id,
    tipo: p.tipo,
    texto: p.texto.trim(),
    obrigatoria: !!p.obrigatoria,
    alerta: !!p.alerta,
    ...(p.tipo === "multipla"
      ? { opcoes: (p.opcoes ?? []).map((o) => o.trim()).filter(Boolean) }
      : {}),
  })) satisfies Pergunta[];
  const erro = erroDasPerguntas(perguntas);
  if (erro) return falha(erro);

  try {
    const supabase = await createClient();
    const { data: ativo, error: erroLeitura } = await supabase
      .from("modelos_anamnese")
      .select("titulo, perguntas")
      .eq("ativo", true)
      .maybeSingle();
    if (erroLeitura) return falha(mensagemErroBanco(erroLeitura));
    if (
      ativo &&
      !precisaNovaVersao(
        ativo.perguntas as unknown as Pergunta[],
        perguntas,
        ativo.titulo,
        titulo,
      )
    ) {
      return OK;
    }

    const { error } = await supabase.rpc("salvar_modelo_anamnese", {
      p_titulo: titulo,
      p_perguntas: perguntas,
    });
    if (error) return falha(mensagemErroBanco(error));
    revalidatePath("/configuracoes/anamnese");
    return OK;
  } catch {
    return falha(ERRO_INESPERADO);
  }
}
