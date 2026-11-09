import "server-only";
import type { StatusAgendamento } from "@/lib/dominio/status";
import { combinarDataHora, dataNoFuso } from "@/lib/dominio/tempo";
import { listarPedidos } from "@/features/pedidos/dados";
import { createClient } from "@/lib/supabase/server";
import { agruparPorHorario, estoqueBaixo, type ProdutoEstoque } from "./painel";

type Supabase = Awaited<ReturnType<typeof createClient>>;

export type ItemAgenda = {
  id: string;
  inicio: string;
  status: StatusAgendamento;
  clienteNome: string;
  servicoNome: string;
  profissionalNome: string;
};

export type ItemSemPagamento = {
  id: string;
  inicio: string;
  /** Dia do atendimento em São Paulo (yyyy-MM-dd). */
  dia: string;
  clienteId: string;
  clienteNome: string;
  servicoNome: string;
  valorPrevistoCentavos: number;
};

export type Aniversariante = {
  id: string;
  nome: string;
  dataNascimento: string | null;
  whatsapp: string | null;
};

const SELECT_AGENDA =
  "id, inicio, status, clientes(nome), servicos(nome), colaboradores!agendamentos_profissional_id_fkey(nome)";

type LinhaAgenda = {
  id: string;
  inicio: string;
  status: StatusAgendamento;
  clientes: { nome: string } | null;
  servicos: { nome: string } | null;
  colaboradores: { nome: string } | null;
};

function paraItem(l: LinhaAgenda): ItemAgenda {
  return {
    id: l.id,
    inicio: l.inicio,
    status: l.status,
    clienteNome: l.clientes?.nome ?? "—",
    servicoNome: l.servicos?.nome ?? "—",
    profissionalNome: l.colaboradores?.nome ?? "—",
  };
}

const proximoDia = (data: string) =>
  new Date(Date.UTC(+data.slice(0, 4), +data.slice(5, 7) - 1, +data.slice(8, 10) + 1))
    .toISOString()
    .slice(0, 10);

function falhou(onde: string, error: { message: string } | null) {
  if (error) throw new Error(`Falha ao carregar ${onde}: ${error.message}`);
}

/** Atendimentos do dia (sem cancelados), por horário. O RLS limita a profissional aos seus. */
export async function atendimentosDoDia(supabase: Supabase, hoje: string): Promise<ItemAgenda[]> {
  const { data, error } = await supabase
    .from("agendamentos")
    .select(SELECT_AGENDA)
    .gte("inicio", combinarDataHora(hoje, "00:00").toISOString())
    .lt("inicio", combinarDataHora(proximoDia(hoje), "00:00").toISOString())
    .neq("status", "cancelado")
    .order("inicio");
  falhou("os atendimentos de hoje", error);
  return agruparPorHorario((data ?? []).map((l) => paraItem(l as unknown as LinhaAgenda)));
}

/** Pendentes de hoje e de amanhã. */
export async function aguardandoConfirmacao(
  supabase: Supabase,
  hoje: string,
  amanha: string,
): Promise<ItemAgenda[]> {
  const { data, error } = await supabase
    .from("agendamentos")
    .select(SELECT_AGENDA)
    .eq("status", "pendente")
    .gte("inicio", combinarDataHora(hoje, "00:00").toISOString())
    .lt("inicio", combinarDataHora(proximoDia(amanha), "00:00").toISOString())
    .order("inicio");
  falhou("as confirmações pendentes", error);
  return agruparPorHorario((data ?? []).map((l) => paraItem(l as unknown as LinhaAgenda)));
}

/**
 * Atendidos de `de` a `ate` (dias de São Paulo) ainda sem pagamento. A RPC só
 * devolve algo para dona/recepção.
 */
export async function atendidosSemPagamento(
  supabase: Supabase,
  de: string,
  ate: string,
): Promise<ItemSemPagamento[]> {
  const { data: ids, error: erroIds } = await supabase.rpc("agendamentos_sem_pagamento_periodo", {
    p_de: de,
    p_ate: ate,
  });
  falhou("os atendimentos sem pagamento", erroIds);
  if (!ids || ids.length === 0) return [];

  const { data, error } = await supabase
    .from("agendamentos")
    .select("id, inicio, cliente_id, valor_previsto_centavos, clientes(nome), servicos(nome)")
    .in("id", ids)
    .order("inicio");
  falhou("os atendimentos sem pagamento", error);
  return (data ?? []).map((a) => ({
    id: a.id,
    inicio: a.inicio,
    dia: dataNoFuso(a.inicio),
    clienteId: a.cliente_id,
    clienteNome: a.clientes?.nome ?? "—",
    servicoNome: a.servicos?.nome ?? "—",
    valorPrevistoCentavos: a.valor_previsto_centavos,
  }));
}

export type ItemSemTermo = {
  id: string;
  inicio: string;
  clienteId: string;
  clienteNome: string;
  servicoNome: string;
};

/** Atendidos de `de` a `ate` (dias de São Paulo) cujo termo não foi assinado. Só a dona recebe linhas. */
export async function atendidosSemTermo(
  supabase: Supabase,
  de: string,
  ate: string,
): Promise<ItemSemTermo[]> {
  const { data: ids, error: erroIds } = await supabase.rpc("atendimentos_sem_termo", {
    p_de: de,
    p_ate: ate,
  });
  falhou("os atendimentos sem termo", erroIds);
  if (!ids || ids.length === 0) return [];

  const { data, error } = await supabase
    .from("agendamentos")
    .select("id, inicio, cliente_id, clientes(nome), servicos(nome)")
    .in("id", ids)
    .order("inicio", { ascending: false });
  falhou("os atendimentos sem termo", error);
  return (data ?? []).map((a) => ({
    id: a.id,
    inicio: a.inicio,
    clienteId: a.cliente_id,
    clienteNome: a.clientes?.nome ?? "—",
    servicoNome: a.servicos?.nome ?? "—",
  }));
}

/**
 * Aniversariantes do período, filtrados no banco (sem limite de linhas) e
 * ordenados pelos dias até o aniversário a partir de `de` (virada de ano).
 */
export async function aniversariantesDaSemana(
  supabase: Supabase,
  de: string,
  ate: string,
): Promise<Aniversariante[]> {
  const { data, error } = await supabase.rpc("aniversariantes_entre", { p_de: de, p_ate: ate });
  falhou("os aniversariantes", error);
  return [...(data ?? [])]
    .sort((a, b) => a.dias - b.dias || a.nome.localeCompare(b.nome, "pt-BR"))
    .map((c) => ({
      id: c.id,
      nome: c.nome,
      dataNascimento: c.data_nascimento,
      whatsapp: c.whatsapp,
    }));
}

export async function produtosComEstoqueBaixo(supabase: Supabase) {
  const { data, error } = await supabase
    .from("produtos")
    .select("id, nome, ativo, estoque_atual, estoque_minimo, unidade")
    .eq("ativo", true);
  falhou("o estoque", error);
  return estoqueBaixo((data ?? []) as (ProdutoEstoque & { unidade: string })[]);
}

export type PedidoAguardando = {
  id: string;
  nome: string;
  servicoNome: string;
  inicio: string;
  expiraEm: string;
};

/** Pedidos online aguardando resposta, mais antigo primeiro (só dona/recepção). */
export async function pedidosAguardando(supabase: Supabase): Promise<PedidoAguardando[]> {
  const pedidos = await listarPedidos(supabase, "aguardando");
  return pedidos.map((p) => ({
    id: p.id,
    nome: p.nome ?? "—",
    servicoNome: p.servicoNome,
    inicio: p.inicio,
    expiraEm: p.expiraEm,
  }));
}
