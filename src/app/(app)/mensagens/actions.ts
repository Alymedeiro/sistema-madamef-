"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ROTULO_CLASSIFICACAO, type ClassificacaoResposta } from "@/lib/dominio/whatsapp";
import { perfisComAcesso } from "@/lib/dominio/permissoes";
import { mensagemErroBanco } from "@/lib/erros-db";
import { ERRO_INESPERADO, falha, OK, type Resultado } from "@/lib/resultado";
import { exigirPerfil } from "@/lib/sessao";
import { createClient } from "@/lib/supabase/server";
import { idSchema } from "@/lib/validacao";
import {
  carregarConversa,
  carregarConversaPorTelefone,
  carregarConversas,
  type ItemConversa,
  type ResumoConversa,
} from "./dados";
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

/** Conversa com a cliente (painel "Responder" e recarregamento a cada 15 s). */
export async function buscarConversa(
  clienteId: string,
): Promise<{ ok: true; itens: ItemConversa[] } | { ok: false; erro: string }> {
  await exigirPerfil(...perfisComAcesso("mensagens"));

  const parsed = idSchema.safeParse(clienteId);
  if (!parsed.success) return { ok: false, erro: parsed.error.issues[0].message };

  try {
    const supabase = await createClient();
    return { ok: true, itens: await carregarConversa(supabase, parsed.data) };
  } catch {
    return { ok: false, erro: ERRO_INESPERADO };
  }
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

const idsLidosSchema = z.array(idSchema).max(200, "Muitas mensagens de uma vez.");

/** Marca como lidas todas as recebidas não lidas de uma conversa. */
export async function marcarConversaLida(ids: string[]): Promise<Resultado> {
  await exigirPerfil(...perfisComAcesso("mensagens"));

  const parsed = idsLidosSchema.safeParse(ids);
  if (!parsed.success) return falha(parsed.error.issues[0].message);
  if (parsed.data.length === 0) return OK;

  try {
    const supabase = await createClient();
    const resultados = await Promise.all(
      parsed.data.map((id) => supabase.rpc("marcar_recebida_lida", { p_id: id })),
    );
    const comErro = resultados.find((r) => r.error);
    if (comErro?.error) return falha(mensagemErroBanco(comErro.error));
  } catch {
    return falha(ERRO_INESPERADO);
  }

  revalidar();
  return OK;
}

/** Conversa de um número sem cadastro (só leitura). */
export async function buscarConversaSemCadastro(
  telefone: string,
): Promise<{ ok: true; itens: ItemConversa[] } | { ok: false; erro: string }> {
  await exigirPerfil(...perfisComAcesso("mensagens"));

  if (!/^\d{8,15}$/.test(telefone)) return { ok: false, erro: "Telefone inválido." };

  try {
    const supabase = await createClient();
    return { ok: true, itens: await carregarConversaPorTelefone(supabase, telefone) };
  } catch {
    return { ok: false, erro: ERRO_INESPERADO };
  }
}

/** Lista de conversas para o recarregamento periódico da aba Respostas. */
export async function listarConversas(
  classificacao: ClassificacaoResposta | null,
): Promise<{ ok: true; conversas: ResumoConversa[] } | { ok: false; erro: string }> {
  await exigirPerfil(...perfisComAcesso("mensagens"));

  if (classificacao !== null && !Object.hasOwn(ROTULO_CLASSIFICACAO, classificacao)) {
    return { ok: false, erro: "Filtro inválido." };
  }

  try {
    const supabase = await createClient();
    return {
      ok: true,
      conversas: await carregarConversas(supabase, classificacao ? { classificacao } : {}),
    };
  } catch {
    return { ok: false, erro: ERRO_INESPERADO };
  }
}
