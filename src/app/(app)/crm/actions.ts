"use server";

import { revalidatePath } from "next/cache";
import { perfisComAcesso } from "@/lib/dominio/permissoes";
import { mensagemErroBanco } from "@/lib/erros-db";
import { ERRO_INESPERADO, falha, OK, type Resultado } from "@/lib/resultado";
import { exigirPerfil } from "@/lib/sessao";
import { createClient } from "@/lib/supabase/server";
import { idSchema } from "@/lib/validacao";
import { reativacaoSchema } from "./schemas";

// Dona e recepção (as RPCs conferem de novo no banco). exigirPerfil
// redireciona lançando; por isso fica fora dos try/catch.

function revalidar() {
  revalidatePath("/crm");
  revalidatePath("/mensagens");
  revalidatePath("/inicio");
}

/** "Enviar retorno": põe a mensagem de retorno do atendimento na fila, para agora. */
export async function enviarRetorno(agendamentoId: string): Promise<Resultado> {
  await exigirPerfil(...perfisComAcesso("crm"));

  const parsed = idSchema.safeParse(agendamentoId);
  if (!parsed.success) return falha(parsed.error.issues[0].message);

  try {
    const supabase = await createClient();
    const { error } = await supabase.rpc("enviar_retorno", { p_agendamento: parsed.data });
    if (error) return falha(mensagemErroBanco(error));
  } catch {
    return falha(ERRO_INESPERADO);
  }

  revalidar();
  return OK;
}

export type ResultadoReativacao =
  | { ok: true; enfileiradas: number; puladas: number }
  | { ok: false; erro: string };

/** Reativação em lote (1 a 500 clientes); o banco pula quem não pode receber. */
const nao = (erro: string): ResultadoReativacao => ({ ok: false, erro });

export async function enviarReativacao(clienteIds: string[]): Promise<ResultadoReativacao> {
  await exigirPerfil(...perfisComAcesso("crm"));

  const parsed = reativacaoSchema.safeParse(clienteIds);
  if (!parsed.success) return nao(parsed.error.issues[0].message);

  let enfileiradas: number;
  let puladas: number;
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("enviar_reativacao", { p_clientes: parsed.data });
    if (error) return nao(mensagemErroBanco(error));
    const linha = data?.[0];
    if (!linha) return nao(ERRO_INESPERADO);
    ({ enfileiradas, puladas } = linha);
  } catch {
    return nao(ERRO_INESPERADO);
  }

  revalidar();
  return { ok: true, enfileiradas, puladas };
}
