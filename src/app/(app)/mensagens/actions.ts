"use server";

import { revalidatePath } from "next/cache";
import { perfisComAcesso } from "@/lib/dominio/permissoes";
import { mensagemErroBanco } from "@/lib/erros-db";
import { ERRO_INESPERADO, falha, OK, type Resultado } from "@/lib/resultado";
import { exigirPerfil } from "@/lib/sessao";
import { createClient } from "@/lib/supabase/server";
import { idSchema } from "@/lib/validacao";
import {
  cancelamentoSchema,
  envioSchema,
  type CancelamentoInput,
  type EnvioInput,
} from "./schemas";

// Dona e recepção (as RPCs conferem de novo no banco). exigirPerfil
// redireciona lançando; por isso fica fora dos try/catch.

function revalidar() {
  revalidatePath("/mensagens");
  revalidatePath("/inicio");
}

/** Envio avulso: entra na fila como pendente para agora. */
export async function enviarWhatsApp(dados: EnvioInput): Promise<Resultado> {
  await exigirPerfil(...perfisComAcesso("mensagens"));

  const parsed = envioSchema.safeParse(dados);
  if (!parsed.success) return falha(parsed.error.issues[0].message);
  const { clienteId, texto, agendamentoId } = parsed.data;

  try {
    const supabase = await createClient();
    const { error } = await supabase.rpc("enviar_avulsa", {
      p_cliente: clienteId,
      p_texto: texto,
      p_agendamento: agendamentoId ?? null,
    });
    if (error) return falha(mensagemErroBanco(error));
  } catch {
    return falha(ERRO_INESPERADO);
  }

  revalidar();
  return OK;
}

/** Cancela uma mensagem pendente (motivo vazio vira "Cancelada pela equipe" no banco). */
export async function cancelarMensagem(dados: CancelamentoInput): Promise<Resultado> {
  await exigirPerfil(...perfisComAcesso("mensagens"));

  const parsed = cancelamentoSchema.safeParse(dados);
  if (!parsed.success) return falha(parsed.error.issues[0].message);

  try {
    const supabase = await createClient();
    const { error } = await supabase.rpc("cancelar_mensagem", {
      p_id: parsed.data.id,
      p_motivo: parsed.data.motivo ?? "",
    });
    if (error) return falha(mensagemErroBanco(error));
  } catch {
    return falha(ERRO_INESPERADO);
  }

  revalidar();
  return OK;
}

/** "Tentar de novo": nova pendente para agora a partir de uma com falha ou cancelada. */
export async function reenviarMensagem(id: string): Promise<Resultado> {
  await exigirPerfil(...perfisComAcesso("mensagens"));

  const parsed = idSchema.safeParse(id);
  if (!parsed.success) return falha(parsed.error.issues[0].message);

  try {
    const supabase = await createClient();
    const { error } = await supabase.rpc("reenviar_mensagem", { p_id: parsed.data });
    if (error) return falha(mensagemErroBanco(error));
  } catch {
    return falha(ERRO_INESPERADO);
  }

  revalidar();
  return OK;
}

export async function marcarRespostaLida(id: string): Promise<Resultado> {
  await exigirPerfil(...perfisComAcesso("mensagens"));

  const parsed = idSchema.safeParse(id);
  if (!parsed.success) return falha(parsed.error.issues[0].message);

  try {
    const supabase = await createClient();
    const { error } = await supabase.rpc("marcar_recebida_lida", { p_id: parsed.data });
    if (error) return falha(mensagemErroBanco(error));
  } catch {
    return falha(ERRO_INESPERADO);
  }

  revalidar();
  return OK;
}
