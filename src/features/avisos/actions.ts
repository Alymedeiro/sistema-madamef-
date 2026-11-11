"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { mensagemErroBanco } from "@/lib/erros-db";
import { ERRO_INESPERADO, type Resultado } from "@/lib/resultado";
import { exigirPerfil } from "@/lib/sessao";
import { createClient } from "@/lib/supabase/server";
import { MAX_AVISOS_POR_VEZ } from "./texto";

const chavesSchema = z
  .array(z.string().min(1).max(120))
  .min(1, "Nenhum aviso para marcar.")
  .max(MAX_AVISOS_POR_VEZ, "Muitos avisos de uma vez; tente de novo.");

/** Marca avisos como lidos para a dona logada (a função do banco grava só os dela). */
export async function marcarAvisosLidos(chaves: string[]): Promise<Resultado> {
  await exigirPerfil("dona");
  const lido = chavesSchema.safeParse(chaves);
  if (!lido.success) return { ok: false, erro: lido.error.issues[0].message };
  try {
    const supabase = await createClient();
    const { error } = await supabase.rpc("marcar_avisos_lidos", { p_chaves: lido.data });
    if (error) return { ok: false, erro: mensagemErroBanco(error) };
    revalidatePath("/", "layout");
    return { ok: true };
  } catch {
    return { ok: false, erro: ERRO_INESPERADO };
  }
}
