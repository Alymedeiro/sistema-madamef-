"use server";

import { revalidatePath } from "next/cache";
import { BUCKET_SERVICOS_FOTOS } from "@/lib/dominio/servicos-fotos";
import { mensagemErroBanco } from "@/lib/erros-db";
import { ERRO_INESPERADO, falha, OK, type Resultado } from "@/lib/resultado";
import { exigirPerfil } from "@/lib/sessao";
import { createClient } from "@/lib/supabase/server";
import { idSchema } from "@/lib/validacao";
import { fotoServicoSchema, ordemFotosSchema, type FotoServicoInput } from "./schemas";

// Fotos dos serviços (0020). O navegador envia o arquivo direto ao bucket
// público `servicos-fotos` (o Storage só aceita da dona) e depois registra a
// linha aqui. Só a dona escreve (exigirPerfil fora dos try/catch: redireciona
// lançando); o RLS também barra.

function revalidar() {
  revalidatePath("/servicos", "layout");
  revalidatePath("/agendar");
}

export async function registrarFotoServico(dados: FotoServicoInput): Promise<Resultado> {
  await exigirPerfil("dona");
  const parsed = fotoServicoSchema.safeParse(dados);
  if (!parsed.success) return falha(parsed.error.issues[0].message);
  const f = parsed.data;

  try {
    const supabase = await createClient();
    const { error } = await supabase
      .from("servicos_fotos")
      .insert({ servico_id: f.servicoId, caminho: f.caminho, largura: f.largura, altura: f.altura })
      .select("id")
      .single();
    if (error) {
      // Sem a linha, o arquivo não aparece em lugar nenhum: apaga (melhor esforço).
      await supabase.storage.from(BUCKET_SERVICOS_FOTOS).remove([f.caminho]);
      return falha(mensagemErroBanco(error));
    }
  } catch {
    return falha(ERRO_INESPERADO);
  }

  revalidar();
  return OK;
}

export async function reordenarFotosServico(servicoId: string, ids: string[]): Promise<Resultado> {
  await exigirPerfil("dona");
  if (!idSchema.safeParse(servicoId).success) return falha("Serviço inválido.");
  const parsed = ordemFotosSchema.safeParse(ids);
  if (!parsed.success) return falha(parsed.error.issues[0].message);

  try {
    const supabase = await createClient();
    const { error } = await supabase.rpc("reordenar_fotos_servico", {
      p_servico: servicoId,
      p_ids: parsed.data,
    });
    if (error) return falha(mensagemErroBanco(error));
  } catch {
    return falha(ERRO_INESPERADO);
  }

  revalidar();
  return OK;
}

export async function removerFotoServico(id: string): Promise<Resultado> {
  await exigirPerfil("dona");
  if (!idSchema.safeParse(id).success) return falha("Foto inválida.");

  try {
    const supabase = await createClient();
    const { data: foto, error: erroLeitura } = await supabase
      .from("servicos_fotos")
      .select("id, caminho")
      .eq("id", id)
      .maybeSingle();
    if (erroLeitura) return falha(mensagemErroBanco(erroLeitura));
    if (!foto) return falha("Foto não encontrada.");

    // Linha antes do arquivo: se o arquivo falhar, sobra só um arquivo órfão
    // (nunca uma foto quebrada na tela). O banco renumera as que sobram.
    const { data, error } = await supabase.from("servicos_fotos").delete().eq("id", id).select("id");
    if (error) return falha(mensagemErroBanco(error));
    if (!data?.length) return falha("Foto não encontrada.");

    await supabase.storage.from(BUCKET_SERVICOS_FOTOS).remove([foto.caminho]);
  } catch {
    return falha(ERRO_INESPERADO);
  }

  revalidar();
  return OK;
}
