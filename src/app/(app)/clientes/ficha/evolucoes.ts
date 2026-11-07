"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { MAX_TEXTO_EVOLUCAO, podeEditarEvolucao } from "@/lib/dominio/evolucoes";
import { mensagemErroBanco } from "@/lib/erros-db";
import { registrarAcesso } from "@/lib/ficha/acesso";
import { ERRO_INESPERADO, type Resultado } from "@/lib/resultado";
import { exigirPerfil } from "@/lib/sessao";
import { createClient } from "@/lib/supabase/server";
import { idSchema } from "@/lib/validacao";

const NAO_ENCONTRADO = "Atendimento não encontrado.";

const textoSchema = z
  .string()
  .trim()
  .min(1, "Escreva a evolução.")
  .max(MAX_TEXTO_EVOLUCAO, `A evolução pode ter no máximo ${MAX_TEXTO_EVOLUCAO} caracteres.`);

export type EvolucaoVista = {
  id: string;
  texto: string;
  criadoEm: string;
  profissionalNome: string;
  editavel: boolean;
};

const um = <T,>(v: T | T[] | null | undefined): T | null =>
  Array.isArray(v) ? (v[0] ?? null) : (v ?? null);

/**
 * Registra a evolução de um atendimento da própria profissional. A cliente vem
 * do agendamento (lido com RLS), nunca do navegador; autora e datas são do banco.
 */
export async function adicionarEvolucao(
  agendamentoId: string,
  texto: string,
): Promise<{ ok: true; id: string } | { ok: false; erro: string }> {
  const { colaborador } = await exigirPerfil("profissional");
  if (!idSchema.safeParse(agendamentoId).success) return { ok: false, erro: NAO_ENCONTRADO };
  const lido = textoSchema.safeParse(texto);
  if (!lido.success) return { ok: false, erro: lido.error.issues[0].message };

  try {
    const supabase = await createClient();
    const { data: ag, error: erroAg } = await supabase
      .from("agendamentos")
      .select("cliente_id, profissional_id")
      .eq("id", agendamentoId)
      .maybeSingle();
    if (erroAg) return { ok: false, erro: mensagemErroBanco(erroAg) };
    if (!ag || ag.profissional_id !== colaborador.id) return { ok: false, erro: NAO_ENCONTRADO };

    const { data, error } = await supabase
      .from("evolucoes")
      .insert({ agendamento_id: agendamentoId, cliente_id: ag.cliente_id, texto: lido.data })
      .select("id")
      .single();
    if (error || !data) return { ok: false, erro: mensagemErroBanco(error ?? {}) };
    revalidatePath(`/clientes/${ag.cliente_id}`);
    return { ok: true, id: data.id };
  } catch {
    return { ok: false, erro: ERRO_INESPERADO };
  }
}

/** Edita o texto da própria evolução; a janela de 24 h é do banco (`evolucoes_guarda`). */
export async function editarEvolucao(id: string, texto: string): Promise<Resultado> {
  const { colaborador } = await exigirPerfil("profissional");
  if (!idSchema.safeParse(id).success) return { ok: false, erro: "Evolução não encontrada." };
  const lido = textoSchema.safeParse(texto);
  if (!lido.success) return { ok: false, erro: lido.error.issues[0].message };

  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("evolucoes")
      .update({ texto: lido.data })
      .eq("id", id)
      .eq("profissional_id", colaborador.id)
      .select("id, cliente_id");
    if (error) return { ok: false, erro: mensagemErroBanco(error) };
    if (!data || data.length === 0) return { ok: false, erro: "Evolução não encontrada." };
    revalidatePath(`/clientes/${data[0].cliente_id}`);
    return { ok: true };
  } catch {
    return { ok: false, erro: ERRO_INESPERADO };
  }
}

/** Evoluções de um atendimento. Audita o acesso antes de ler. */
export async function evolucoesDoAtendimento(
  agendamentoId: string,
): Promise<{ ok: true; evolucoes: EvolucaoVista[] } | { ok: false; erro: string }> {
  const { colaborador } = await exigirPerfil();
  if (!idSchema.safeParse(agendamentoId).success) return { ok: false, erro: NAO_ENCONTRADO };
  try {
    const supabase = await createClient();
    const { data: ag, error: erroAg } = await supabase
      .from("agendamentos")
      .select("cliente_id")
      .eq("id", agendamentoId)
      .maybeSingle();
    if (erroAg) return { ok: false, erro: mensagemErroBanco(erroAg) };
    if (!ag) return { ok: false, erro: NAO_ENCONTRADO };

    try {
      await registrarAcesso(supabase, { entidade: "evolucoes", clienteId: ag.cliente_id });
    } catch {
      return { ok: false, erro: "Não foi possível registrar o acesso. Tente novamente." };
    }

    const { data, error } = await supabase
      .from("evolucoes")
      .select("id, texto, criado_em, profissional_id, colaboradores!evolucoes_profissional_id_fkey(nome)")
      .eq("agendamento_id", agendamentoId)
      .order("criado_em", { ascending: true });
    if (error) return { ok: false, erro: mensagemErroBanco(error) };

    const agora = new Date();
    return {
      ok: true,
      evolucoes: (data ?? []).map((e) => ({
        id: e.id,
        texto: e.texto,
        criadoEm: e.criado_em,
        profissionalNome: um(e.colaboradores)?.nome ?? "—",
        editavel:
          colaborador.perfil === "profissional" &&
          podeEditarEvolucao(
            { profissionalId: e.profissional_id, criadoEm: e.criado_em },
            colaborador.id,
            agora,
          ),
      })),
    };
  } catch {
    return { ok: false, erro: ERRO_INESPERADO };
  }
}
