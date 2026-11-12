"use server";

import { revalidatePath } from "next/cache";
import { perfisComAcesso } from "@/lib/dominio/permissoes";
import { mensagemErroBanco } from "@/lib/erros-db";
import { ERRO_INESPERADO, falha, OK, type Resultado } from "@/lib/resultado";
import { exigirPerfil } from "@/lib/sessao";
import { createClient } from "@/lib/supabase/server";
import { idSchema } from "@/lib/validacao";
import {
  converterLeadSchema,
  leadSchema,
  moverLeadSchema,
  reativacaoSchema,
  whatsappLeadSchema,
  type ConverterLeadInput,
  type LeadInput,
  type MoverLeadInput,
  type WhatsappLeadInput,
} from "./schemas";

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

const LEAD_NAO_ENCONTRADO = "Lead não encontrado.";

/** Cria (sem `id`) ou edita um lead. Só colunas do formulário: etapa e conversão têm ações próprias. */
export async function salvarLead(dados: LeadInput & { id?: string }): Promise<Resultado> {
  await exigirPerfil(...perfisComAcesso("crm"));

  const { id, ...resto } = dados;
  if (id !== undefined) {
    const idOk = idSchema.safeParse(id);
    if (!idOk.success) return falha(idOk.error.issues[0].message);
  }
  const parsed = leadSchema.safeParse(resto);
  if (!parsed.success) return falha(parsed.error.issues[0].message);
  const d = parsed.data;
  const linha = {
    nome: d.nome,
    whatsapp: d.whatsapp,
    servico_id: d.servicoId,
    origem: d.origem,
    responsavel_id: d.responsavelId,
    observacoes: d.observacoes,
  };

  try {
    const supabase = await createClient();
    if (id === undefined) {
      const { error } = await supabase.from("leads").insert(linha);
      if (error) return falha(mensagemErroBanco(error));
    } else {
      const { data, error } = await supabase.from("leads").update(linha).eq("id", id).select("id");
      if (error) return falha(mensagemErroBanco(error));
      if (!data || data.length === 0) return falha(LEAD_NAO_ENCONTRADO);
    }
  } catch {
    return falha(ERRO_INESPERADO);
  }

  revalidar();
  return OK;
}

/** Muda a etapa. O motivo só vale para `perdido` (nas outras o banco o limpa). */
export async function moverLead(dados: MoverLeadInput): Promise<Resultado> {
  await exigirPerfil(...perfisComAcesso("crm"));

  const parsed = moverLeadSchema.safeParse(dados);
  if (!parsed.success) return falha(parsed.error.issues[0].message);
  const { id, etapa, motivo } = parsed.data;
  const linha =
    etapa === "perdido" ? { etapa, perdido_motivo: motivo ? motivo : null } : { etapa };

  try {
    const supabase = await createClient();
    const { data, error } = await supabase.from("leads").update(linha).eq("id", id).select("id");
    if (error) return falha(mensagemErroBanco(error));
    if (!data || data.length === 0) return falha(LEAD_NAO_ENCONTRADO);
  } catch {
    return falha(ERRO_INESPERADO);
  }

  revalidar();
  return OK;
}

export type ResultadoConversao = { ok: true; clienteId: string } | { ok: false; erro: string };

/** Converte o lead em cliente (ou o liga à cliente de mesmo WhatsApp). */
export async function converterLead(dados: ConverterLeadInput): Promise<ResultadoConversao> {
  await exigirPerfil(...perfisComAcesso("crm"));

  const parsed = converterLeadSchema.safeParse(dados);
  if (!parsed.success) return { ok: false, erro: parsed.error.issues[0].message };

  let clienteId: string;
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("converter_lead", {
      p_lead: parsed.data.id,
      p_aceite_lgpd: parsed.data.aceiteLgpd,
      p_aceita_marketing: parsed.data.aceitaMarketing,
    });
    if (error) return { ok: false, erro: mensagemErroBanco(error) };
    if (!data) return { ok: false, erro: ERRO_INESPERADO };
    clienteId = data;
  } catch {
    return { ok: false, erro: ERRO_INESPERADO };
  }

  revalidar();
  revalidatePath("/clientes");
  return { ok: true, clienteId };
}

/** WhatsApp avulso para o lead (entra na fila como pendente). */
export async function enviarWhatsAppLead(dados: WhatsappLeadInput): Promise<Resultado> {
  await exigirPerfil(...perfisComAcesso("crm"));

  const parsed = whatsappLeadSchema.safeParse(dados);
  if (!parsed.success) return falha(parsed.error.issues[0].message);

  try {
    const supabase = await createClient();
    const { error } = await supabase.rpc("enviar_avulsa_lead", {
      p_lead: parsed.data.id,
      p_texto: parsed.data.texto,
    });
    if (error) return falha(mensagemErroBanco(error));
  } catch {
    return falha(ERRO_INESPERADO);
  }

  revalidar();
  return OK;
}
