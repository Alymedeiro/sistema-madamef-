import "server-only";
import {
  alertasDaAnamnese,
  anamnesePendente,
  respostasLegiveis,
  type Pergunta,
  type Respostas,
} from "@/lib/dominio/anamnese";
import { registrarAcesso, type Supabase } from "@/lib/ficha/acesso";

export type AnamneseFicha = {
  id: string;
  preenchidaEm: string;
  versao: number;
  preenchidaPor: string;
  itens: ReturnType<typeof respostasLegiveis>;
  alertas: string[];
};

const um = <T,>(v: T | T[] | null | undefined): T | null =>
  Array.isArray(v) ? (v[0] ?? null) : (v ?? null);

/** Anamneses da cliente, da mais recente para a mais antiga. Audita antes de ler. */
export async function carregarAnamneses(
  supabase: Supabase,
  clienteId: string,
): Promise<AnamneseFicha[]> {
  await registrarAcesso(supabase, { entidade: "anamneses", clienteId });
  const { data, error } = await supabase
    .from("anamneses")
    .select(
      "id, preenchida_em, modelo_versao, respostas, modelos_anamnese(perguntas), colaboradores!anamneses_preenchida_por_fkey(nome)",
    )
    .eq("cliente_id", clienteId)
    .order("preenchida_em", { ascending: false });
  if (error) throw new Error(`Falha ao carregar as anamneses: ${error.message}`);

  return (data ?? []).map((a) => {
    // As perguntas são as da versão da própria anamnese.
    const perguntas = (um(a.modelos_anamnese)?.perguntas ?? []) as unknown as Pergunta[];
    const respostas = a.respostas as unknown as Respostas;
    return {
      id: a.id,
      preenchidaEm: a.preenchida_em,
      versao: a.modelo_versao,
      preenchidaPor: um(a.colaboradores)?.nome ?? "—",
      itens: respostasLegiveis(perguntas, respostas),
      alertas: alertasDaAnamnese(perguntas, respostas),
    };
  });
}

/** Indicadores do topo da ficha: pendência e textos dos alertas da última anamnese. */
export async function carregarAlertasCabecalho(
  supabase: Supabase,
  clienteId: string,
  agora: Date = new Date(),
): Promise<{ pendente: boolean; alertas: string[] }> {
  const { data, error } = await supabase.rpc("situacao_ficha", { p_clientes: [clienteId] });
  if (error) throw new Error(`Falha ao carregar a situação da ficha: ${error.message}`);
  const s = (data ?? []).find((l) => l.cliente_id === clienteId);
  const pendente = anamnesePendente(s?.ultima_anamnese_em ?? null, agora);
  if (!s?.tem_alerta) return { pendente, alertas: [] };

  const { data: ultima, error: erroUltima } = await supabase
    .from("anamneses")
    .select("id, respostas, modelos_anamnese(perguntas)")
    .eq("cliente_id", clienteId)
    .order("preenchida_em", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (erroUltima) throw new Error(`Falha ao carregar a anamnese: ${erroUltima.message}`);
  if (!ultima) return { pendente, alertas: [] };
  await registrarAcesso(supabase, {
    entidade: "anamneses",
    entidadeId: ultima.id,
    clienteId,
  });
  const perguntas = (um(ultima.modelos_anamnese)?.perguntas ?? []) as unknown as Pergunta[];
  return {
    pendente,
    alertas: alertasDaAnamnese(perguntas, ultima.respostas as unknown as Respostas),
  };
}

export type TermosFicha = {
  assinados: {
    id: string;
    titulo: string;
    versao: number;
    assinadoEm: string;
    colhidoPor: string;
    /** A versão assinada ainda é a vigente do termo. */
    atual: boolean;
  }[];
  pendentes: { modeloTermoId: string; titulo: string }[];
};

/**
 * Termos assinados da cliente (do mais recente) e os exigidos pelos serviços
 * que ela já agendou e ainda não assinou na versão atual. Audita antes de ler.
 */
export async function carregarTermos(
  supabase: Supabase,
  clienteId: string,
): Promise<TermosFicha> {
  await registrarAcesso(supabase, { entidade: "termos_assinados", clienteId });
  const [termosRes, agendamentosRes] = await Promise.all([
    supabase
      .from("termos_assinados")
      .select(
        "id, assinado_em, modelo_versao, modelo_termo_id, modelos_termo(titulo, ativo), colaboradores!termos_assinados_colhido_por_fkey(nome)",
      )
      .eq("cliente_id", clienteId)
      .order("assinado_em", { ascending: false }),
    supabase
      .from("agendamentos")
      .select("servicos(modelo_termo_id, modelos_termo(id, titulo))")
      .eq("cliente_id", clienteId)
      .neq("status", "cancelado"),
  ]);
  if (termosRes.error) throw new Error(`Falha ao carregar os termos: ${termosRes.error.message}`);
  if (agendamentosRes.error) {
    throw new Error(`Falha ao carregar os termos pendentes: ${agendamentosRes.error.message}`);
  }

  const termos = termosRes.data ?? [];
  const assinadosIds = new Set(termos.map((t) => t.modelo_termo_id));
  const pendentes = new Map<string, string>();
  for (const a of agendamentosRes.data ?? []) {
    const servico = um(a.servicos) as {
      modelo_termo_id: string | null;
      modelos_termo: { id: string; titulo: string } | { id: string; titulo: string }[] | null;
    } | null;
    const modelo = um(servico?.modelos_termo);
    if (!modelo || assinadosIds.has(modelo.id)) continue;
    pendentes.set(modelo.id, modelo.titulo);
  }

  return {
    assinados: termos.map((t) => ({
      id: t.id,
      titulo: um(t.modelos_termo)?.titulo ?? "Termo",
      versao: t.modelo_versao,
      assinadoEm: t.assinado_em,
      colhidoPor: um(t.colaboradores)?.nome ?? "—",
      atual: um(t.modelos_termo)?.ativo ?? false,
    })),
    pendentes: [...pendentes].map(([modeloTermoId, titulo]) => ({ modeloTermoId, titulo })),
  };
}
