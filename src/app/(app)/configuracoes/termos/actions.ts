"use server";

import { revalidatePath } from "next/cache";
import { mensagemErroBanco } from "@/lib/erros-db";
import { ERRO_INESPERADO, falha, OK, type Resultado } from "@/lib/resultado";
import { exigirPerfil } from "@/lib/sessao";
import { createClient } from "@/lib/supabase/server";
import { idSchema } from "@/lib/validacao";

const MAX_TEXTO = 20_000;
const MAX_TITULO = 120;

/** Cria um termo (sem `anteriorId`) ou grava uma nova versão do termo existente. */
export async function salvarModeloTermo(dados: {
  anteriorId?: string | null;
  titulo: string;
  texto: string;
}): Promise<Resultado> {
  await exigirPerfil("dona");

  const titulo = String(dados.titulo ?? "").trim();
  const texto = String(dados.texto ?? "").trim();
  const anteriorId = dados.anteriorId ?? null;
  if (!titulo) return falha("Informe o título do termo.");
  if (titulo.length > MAX_TITULO) return falha("O título pode ter no máximo 120 caracteres.");
  if (!texto) return falha("Informe o texto do termo.");
  if (texto.length > MAX_TEXTO) return falha("O texto pode ter no máximo 20 000 caracteres.");
  if (anteriorId !== null && !idSchema.safeParse(anteriorId).success) {
    return falha("Termo inválido.");
  }

  try {
    const supabase = await createClient();
    const { error } = await supabase.rpc("salvar_modelo_termo", {
      p_anterior: anteriorId,
      p_titulo: titulo,
      p_texto: texto,
    });
    if (error) return falha(mensagemErroBanco(error));
    revalidatePath("/configuracoes/termos");
    revalidatePath("/servicos", "layout");
    return OK;
  } catch {
    return falha(ERRO_INESPERADO);
  }
}
