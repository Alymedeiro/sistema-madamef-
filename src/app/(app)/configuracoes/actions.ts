"use server";

import { revalidatePath } from "next/cache";
import { mensagemErroBanco } from "@/lib/erros-db";
import { ERRO_INESPERADO, falha, OK, type Resultado } from "@/lib/resultado";
import { exigirPerfil } from "@/lib/sessao";
import { createClient } from "@/lib/supabase/server";
import {
  configuracoesSchema,
  type ConfiguracoesInput,
  modeloSchema,
  type ModeloInput,
  roboConfigSchema,
  type RoboConfigInput,
  whatsappConfigSchema,
  type WhatsappConfigInput,
} from "./schemas";

export async function salvarConfiguracoes(dados: ConfiguracoesInput): Promise<Resultado> {
  await exigirPerfil("dona");

  const parsed = configuracoesSchema.safeParse(dados);
  if (!parsed.success) return falha(parsed.error.issues[0].message);
  const {
    nome,
    telefone,
    endereco,
    horarioFuncionamento,
    diasClienteSumida,
    onlineAtivo,
    onlineAntecedenciaMinHoras,
    onlineAntecedenciaMaxDias,
    onlineAvisoPrivacidade,
  } = parsed.data;

  try {
    const supabase = await createClient();
    // A tabela guarda uma única linha (linha_unica = true): upsert por essa chave.
    const { error } = await supabase.from("configuracoes_clinica").upsert(
      {
        linha_unica: true,
        nome,
        telefone,
        endereco,
        horario_funcionamento: horarioFuncionamento,
        dias_cliente_sumida: diasClienteSumida,
        online_ativo: onlineAtivo,
        online_antecedencia_min_horas: onlineAntecedenciaMinHoras,
        online_antecedencia_max_dias: onlineAntecedenciaMaxDias,
        online_aviso_privacidade: onlineAvisoPrivacidade,
      },
      { onConflict: "linha_unica" },
    );
    if (error) return falha(mensagemErroBanco(error));
  } catch {
    return falha(ERRO_INESPERADO);
  }

  revalidatePath("/configuracoes");
  return OK;
}

export async function salvarConfigWhatsapp(dados: WhatsappConfigInput): Promise<Resultado> {
  await exigirPerfil("dona");

  const parsed = whatsappConfigSchema.safeParse(dados);
  if (!parsed.success) return falha(parsed.error.issues[0].message);
  const { ativo, janelaInicio, janelaFim, limitePorHora } = parsed.data;

  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("configuracoes_clinica")
      .update({
        whatsapp_ativo: ativo,
        whatsapp_janela_inicio: janelaInicio,
        whatsapp_janela_fim: janelaFim,
        whatsapp_limite_por_hora: limitePorHora,
      })
      .eq("linha_unica", true)
      .select("linha_unica");
    if (error) return falha(mensagemErroBanco(error));
    if (!data || data.length === 0) return falha("Configuração não encontrada.");
  } catch {
    return falha(ERRO_INESPERADO);
  }

  revalidatePath("/configuracoes");
  return OK;
}

export async function salvarModelo(dados: ModeloInput): Promise<Resultado> {
  await exigirPerfil("dona");

  const parsed = modeloSchema.safeParse(dados);
  if (!parsed.success) return falha(parsed.error.issues[0].message);
  const { tipo, variacoes, ativo } = parsed.data;

  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("modelos_mensagem")
      .update({ variacoes, ativo, atualizado_em: new Date().toISOString() })
      .eq("tipo", tipo)
      .select("tipo");
    if (error) return falha(mensagemErroBanco(error));
    if (!data || data.length === 0) return falha("Modelo não encontrado.");
  } catch {
    return falha(ERRO_INESPERADO);
  }

  revalidatePath("/configuracoes");
  return OK;
}

/** Robô de atendimento: configuração e opções de uma vez (salvar_robo, só a dona). */
export async function salvarRobo(dados: RoboConfigInput): Promise<Resultado> {
  await exigirPerfil("dona");

  const parsed = roboConfigSchema.safeParse(dados);
  if (!parsed.success) return falha(parsed.error.issues[0].message);
  const { ativo, quando, boasVindas, naoEntendi, rodapeOpcao, linkAgendamento, opcoes } =
    parsed.data;

  try {
    const supabase = await createClient();
    const { error } = await supabase.rpc("salvar_robo", {
      p_ativo: ativo,
      p_quando: quando,
      p_boas_vindas: boasVindas,
      p_nao_entendi: naoEntendi,
      p_rodape_opcao: rodapeOpcao,
      p_link_agendamento: linkAgendamento,
      p_opcoes: [...opcoes].sort((a, b) => a.numero - b.numero),
    });
    if (error) return falha(mensagemErroBanco(error));
  } catch {
    return falha(ERRO_INESPERADO);
  }

  revalidatePath("/configuracoes");
  return OK;
}
