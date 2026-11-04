"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { TIPOS_FOTO } from "@/lib/dominio/fotos";
import { mensagemErroBanco } from "@/lib/erros-db";
import { registrarAcesso } from "@/lib/ficha/acesso";
import { BUCKET_FICHA, URL_ASSINADA_SEGUNDOS, caminhoPertence } from "@/lib/ficha/caminhos";
import { ERRO_INESPERADO, type Resultado } from "@/lib/resultado";
import { exigirPerfil } from "@/lib/sessao";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { idSchema } from "@/lib/validacao";

const FOTO_INVALIDA = "Foto inválida.";
const MAX_ITENS_REGISTRO = 20;
const MAX_URLS = 60;

const itemSchema = z.object({
  path: z.string().max(200),
  tipo: z.enum(TIPOS_FOTO as [string, ...string[]]),
  servicoId: idSchema.nullish(),
  agendamentoId: idSchema.nullish(),
});

/** Apaga do Storage só os caminhos que NÃO estão em `fotos` (nenhum dado clínico é removido). */
async function removerOrfaos(paths: string[]): Promise<void> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin.from("fotos").select("path").in("path", paths);
    if (error) return; // sem certeza do que é órfão: não apaga
    const registrados = new Set((data ?? []).map((f) => f.path));
    const orfaos = paths.filter((p) => !registrados.has(p));
    if (orfaos.length > 0) await admin.storage.from(BUCKET_FICHA).remove(orfaos);
  } catch {
    // melhor esforço: arquivo órfão não é lido por ninguém (sem linha em `fotos`).
  }
}

/**
 * Grava no banco as fotos que o navegador já enviou ao Storage (com o JWT da
 * usuária). Confere que todo caminho é desta cliente, da área `fotos` e `.jpg`
 * antes de gravar qualquer linha; se o insert falhar, apaga os arquivos órfãos.
 */
export async function registrarFotos(
  clienteId: string,
  itens: {
    path: string;
    tipo: "antes" | "depois" | "evolucao";
    servicoId?: string | null;
    agendamentoId?: string | null;
  }[],
): Promise<Resultado> {
  await exigirPerfil("dona", "profissional");

  if (!idSchema.safeParse(clienteId).success) return { ok: false, erro: ERRO_INESPERADO };
  if (!Array.isArray(itens) || itens.length < 1 || itens.length > MAX_ITENS_REGISTRO) {
    return { ok: false, erro: `Envie de 1 a ${MAX_ITENS_REGISTRO} fotos por vez.` };
  }
  const lido = z.array(itemSchema).safeParse(itens);
  if (!lido.success) return { ok: false, erro: FOTO_INVALIDA };
  if (!lido.data.every((i) => i.path.endsWith(".jpg") && caminhoPertence(i.path, clienteId, "fotos"))) {
    return { ok: false, erro: FOTO_INVALIDA };
  }
  const paths = lido.data.map((i) => i.path);
  if (new Set(paths).size !== paths.length) return { ok: false, erro: FOTO_INVALIDA };

  try {
    const supabase = await createClient();
    const { error } = await supabase.from("fotos").insert(
      lido.data.map((i) => ({
        cliente_id: clienteId,
        path: i.path,
        tipo: i.tipo as "antes" | "depois" | "evolucao",
        servico_id: i.servicoId ?? null,
        agendamento_id: i.agendamentoId ?? null,
      })),
    );
    if (error) {
      // Caminho repetido (23505) prova que o arquivo já é de uma foto registrada: nunca apagar.
      if (error.code !== "23505") await removerOrfaos(paths);
      return { ok: false, erro: mensagemErroBanco(error) };
    }
    revalidatePath(`/clientes/${clienteId}`);
    return { ok: true };
  } catch {
    return { ok: false, erro: ERRO_INESPERADO };
  }
}

/** URLs assinadas (5 min) das fotos pedidas; cada leitura é auditada antes de assinar. */
export async function urlsFotos(
  ids: string[],
): Promise<{ ok: true; urls: Record<string, string> } | { ok: false; erro: string }> {
  await exigirPerfil("dona", "profissional");
  if (
    !Array.isArray(ids) ||
    ids.length < 1 ||
    ids.length > MAX_URLS ||
    !ids.every((id) => idSchema.safeParse(id).success)
  ) {
    return { ok: false, erro: "Foto não encontrada." };
  }
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("fotos")
      .select("id, cliente_id, path")
      .in("id", ids);
    if (error) return { ok: false, erro: mensagemErroBanco(error) };
    const linhas = data ?? [];
    if (linhas.length === 0) return { ok: false, erro: "Foto não encontrada." };

    try {
      for (const f of linhas) {
        await registrarAcesso(supabase, {
          entidade: "fotos",
          entidadeId: f.id,
          clienteId: f.cliente_id,
        });
      }
    } catch {
      return { ok: false, erro: "Não foi possível registrar o acesso. Tente novamente." };
    }

    const { data: assinadas, error: erroUrl } = await supabase.storage
      .from(BUCKET_FICHA)
      .createSignedUrls(
        linhas.map((f) => f.path),
        URL_ASSINADA_SEGUNDOS,
      );
    if (erroUrl || !assinadas) return { ok: false, erro: ERRO_INESPERADO };
    const porPath = new Map(assinadas.map((a) => [a.path, a.signedUrl]));
    const urls: Record<string, string> = {};
    for (const f of linhas) {
      const u = porPath.get(f.path);
      if (u) urls[f.id] = u;
    }
    return { ok: true, urls };
  } catch {
    return { ok: false, erro: ERRO_INESPERADO };
  }
}

/** Só a dona arquiva; a foto some da galeria (e do Storage para as demais). */
export async function arquivarFoto(id: string): Promise<Resultado> {
  await exigirPerfil("dona");
  if (!idSchema.safeParse(id).success) return { ok: false, erro: "Foto não encontrada." };
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("fotos")
      .update({ arquivada: true })
      .eq("id", id)
      .eq("arquivada", false)
      .select("id, cliente_id");
    if (error) return { ok: false, erro: mensagemErroBanco(error) };
    if (!data || data.length === 0) return { ok: false, erro: "Foto não encontrada." };
    const clienteId = (data[0] as { cliente_id?: string }).cliente_id;
    if (clienteId) revalidatePath(`/clientes/${clienteId}`);
    return { ok: true };
  } catch {
    return { ok: false, erro: ERRO_INESPERADO };
  }
}
