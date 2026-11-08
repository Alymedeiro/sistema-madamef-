import "server-only";
import { RESERVA_HORAS } from "@/lib/dominio/online";
import { normalizarWhatsApp } from "@/lib/dominio/telefone";
import type { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/tipos";

type Supabase = Awaited<ReturnType<typeof createClient>>;

export type StatusPedido = Database["public"]["Enums"]["status_pedido_online"];

export const STATUS_PEDIDO: readonly StatusPedido[] = [
  "aguardando",
  "aprovado",
  "recusado",
  "expirado",
];

export type PedidoLista = {
  id: string;
  /** null depois da limpeza LGPD (90 dias, não aprovados). */
  nome: string | null;
  whatsapp: string | null;
  servicoId: string;
  servicoNome: string;
  profissionalId: string;
  profissionalNome: string;
  inicio: string;
  fim: string;
  avaliacao: boolean;
  status: StatusPedido;
  criadoEm: string;
  /** criadoEm + RESERVA_HORAS (ISO). */
  expiraEm: string;
  agendamentoId: string | null;
  motivoRecusa: string | null;
};

const SELECT_PEDIDO =
  "id, nome, whatsapp, servico_id, profissional_id, inicio, fim, avaliacao, status, criado_em, " +
  "agendamento_id, motivo_recusa, servicos(nome), " +
  "colaboradores!pedidos_online_profissional_id_fkey(nome)";

type LinhaPedido = {
  id: string;
  nome: string | null;
  whatsapp: string | null;
  servico_id: string;
  profissional_id: string;
  inicio: string;
  fim: string;
  avaliacao: boolean;
  status: StatusPedido;
  criado_em: string;
  agendamento_id: string | null;
  motivo_recusa: string | null;
  servicos: { nome: string } | null;
  colaboradores: { nome: string } | null;
};

export function expiraEm(criadoEm: string): string {
  return new Date(new Date(criadoEm).getTime() + RESERVA_HORAS * 3600_000).toISOString();
}

function paraLista(l: LinhaPedido): PedidoLista {
  return {
    id: l.id,
    nome: l.nome,
    whatsapp: l.whatsapp,
    servicoId: l.servico_id,
    servicoNome: l.servicos?.nome ?? "—",
    profissionalId: l.profissional_id,
    profissionalNome: l.colaboradores?.nome ?? "—",
    inicio: l.inicio,
    fim: l.fim,
    avaliacao: l.avaliacao,
    status: l.status,
    criadoEm: l.criado_em,
    expiraEm: expiraEm(l.criado_em),
    agendamentoId: l.agendamento_id,
    motivoRecusa: l.motivo_recusa,
  };
}

const LIMITE_RESPONDIDOS = 200;

/**
 * Pedidos de um status. Grava antes os vencidos como expirados, para que um
 * "aguardando" com mais de 24 h nunca apareça como aguardando. Aguardando:
 * mais antigo primeiro (o que vence antes); os demais, mais recente primeiro.
 */
export async function listarPedidos(supabase: Supabase, status: StatusPedido): Promise<PedidoLista[]> {
  const exp = await supabase.rpc("expirar_pedidos_online");
  if (exp.error) throw new Error(`Falha ao carregar os pedidos online: ${exp.error.message}`);

  const aguardando = status === "aguardando";
  let consulta = supabase
    .from("pedidos_online")
    .select(SELECT_PEDIDO)
    .eq("status", status)
    .order("criado_em", { ascending: aguardando });
  if (!aguardando) consulta = consulta.limit(LIMITE_RESPONDIDOS);
  const { data, error } = await consulta;
  if (error) throw new Error(`Falha ao carregar os pedidos online: ${error.message}`);
  return ((data ?? []) as unknown as LinhaPedido[]).map(paraLista);
}

/** Status de um pedido (para abrir a aba certa em ?pedido=<id>); null se não existe. */
export async function statusDoPedido(supabase: Supabase, id: string): Promise<StatusPedido | null> {
  const { data, error } = await supabase
    .from("pedidos_online")
    .select("status")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`Falha ao carregar o pedido online: ${error.message}`);
  return data?.status ?? null;
}

/** Clientes cadastradas com o mesmo WhatsApp (normalizado), para a sugestão ao aprovar. */
export async function clientesPorTelefone(
  supabase: Supabase,
  whatsapp: string,
): Promise<{ id: string; nome: string }[]> {
  const numero = normalizarWhatsApp(whatsapp);
  if (!numero) return [];
  const { data, error } = await supabase
    .from("clientes")
    .select("id, nome")
    .eq("whatsapp", numero)
    .order("nome")
    .limit(5);
  if (error) throw new Error(`Falha ao buscar clientes: ${error.message}`);
  return data ?? [];
}

export type ProfissionalPedido = { id: string; nome: string; servicoIds: string[] };

/** Profissionais ativas com os serviços que fazem (troca de profissional ao aprovar). */
export async function profissionaisAtivas(supabase: Supabase): Promise<ProfissionalPedido[]> {
  const [colaboradores, vinculos] = await Promise.all([
    supabase.from("colaboradores").select("id, nome").eq("ativo", true).order("nome"),
    supabase.from("colaborador_servicos").select("colaborador_id, servico_id"),
  ]);
  if (colaboradores.error || vinculos.error) {
    throw new Error("Falha ao carregar as profissionais.");
  }
  return (colaboradores.data ?? []).map((c) => ({
    id: c.id,
    nome: c.nome,
    servicoIds: (vinculos.data ?? [])
      .filter((v) => v.colaborador_id === c.id)
      .map((v) => v.servico_id),
  }));
}
