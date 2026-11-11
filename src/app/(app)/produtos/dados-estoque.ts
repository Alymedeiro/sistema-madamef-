import "server-only";
import { dataValida, somarDias } from "@/features/agenda/grade";
import type { TipoMovimento } from "@/lib/dominio/estoque";
import { combinarDataHora, dataNoFuso } from "@/lib/dominio/tempo";
import type { createClient } from "@/lib/supabase/server";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** Teto do histórico na tela (mais recentes primeiro). */
export const LIMITE_MOVIMENTOS = 200;

/** Dias do período padrão do histórico (contando hoje). */
const DIAS_PADRAO = 30;

export type ProdutoDoEstoque = {
  id: string;
  nome: string;
  unidade: string;
  ativo: boolean;
  estoqueAtual: number;
  estoqueMinimo: number;
  custoCentavos: number;
  /** Ativo com estoque no mínimo ou abaixo (o mesmo critério do Início). */
  abaixo: boolean;
};

export type MovimentoDoEstoque = {
  id: string;
  criadoEm: string;
  produtoId: string;
  produtoNome: string;
  unidade: string;
  tipo: TipoMovimento;
  /** Com sinal: entrada e estorno > 0; baixa < 0; ajuste ±. */
  quantidade: number;
  /** Custo unitário da entrada. */
  custoCentavos: number | null;
  motivo: string | null;
  /** Baixa/estorno: dia (SP) e cliente do atendimento. */
  atendimento: { data: string; clienteNome: string } | null;
  /** null quando gerado sem usuário (gatilho). */
  responsavelNome: string | null;
};

export type DadosEstoque = {
  /** Ativos primeiro, por nome. */
  produtos: ProdutoDoEstoque[];
  /** Abaixo do mínimo, maior falta primeiro. */
  abaixo: ProdutoDoEstoque[];
  movimentos: MovimentoDoEstoque[];
  /** O histórico bateu no limite: há movimentos mais antigos fora da lista. */
  limitado: boolean;
};

type MovimentoBanco = {
  id: string;
  produto_id: string;
  tipo: TipoMovimento;
  quantidade: number | string;
  custo_unitario_centavos: number | null;
  motivo: string | null;
  agendamento_id: string | null;
  criado_em: string;
  produtos: { nome: string; unidade: string } | null;
  colaboradores: { nome: string } | null;
  agendamentos: { inicio: string; clientes: { nome: string } | null } | null;
};

const COLUNAS_MOVIMENTO =
  "id, produto_id, tipo, quantidade, custo_unitario_centavos, motivo, agendamento_id, criado_em, produtos(nome, unidade), colaboradores(nome), agendamentos(inicio, clientes(nome))";

/** Período do histórico: de/até válidos (de ≤ até) ou os últimos 30 dias até hoje (SP). */
export function periodoDoEstoque(p: { de?: string; ate?: string }, agora: Date): { de: string; ate: string } {
  if (p.de && p.ate && dataValida(p.de) && dataValida(p.ate) && p.de <= p.ate) {
    return { de: p.de, ate: p.ate };
  }
  const hoje = dataNoFuso(agora);
  return { de: somarDias(hoje, -(DIAS_PADRAO - 1)), ate: hoje };
}

/**
 * Movimentos de estoque (dona; RLS), mais recentes primeiro, até 200. Período
 * em dias de São Paulo (inclusive); sem período, todos.
 */
export async function carregarMovimentos(
  supabase: Supabase,
  f: { produtoId?: string | null; de?: string; ate?: string },
): Promise<{ movimentos: MovimentoDoEstoque[]; limitado: boolean }> {
  let q = supabase.from("movimentos_estoque").select(COLUNAS_MOVIMENTO);
  if (f.de) q = q.gte("criado_em", combinarDataHora(f.de, "00:00").toISOString());
  if (f.ate) q = q.lt("criado_em", combinarDataHora(somarDias(f.ate, 1), "00:00").toISOString());
  if (f.produtoId) q = q.eq("produto_id", f.produtoId);
  const { data, error } = await q.order("criado_em", { ascending: false }).limit(LIMITE_MOVIMENTOS);
  if (error) throw new Error(`Falha ao carregar o histórico do estoque: ${error.message}`);

  const linhas = (data ?? []) as unknown as MovimentoBanco[];
  return {
    movimentos: linhas.map((m) => ({
      id: m.id,
      criadoEm: m.criado_em,
      produtoId: m.produto_id,
      produtoNome: m.produtos?.nome ?? "—",
      unidade: m.produtos?.unidade ?? "",
      tipo: m.tipo,
      quantidade: Number(m.quantidade),
      custoCentavos: m.custo_unitario_centavos,
      motivo: m.motivo,
      atendimento: m.agendamentos
        ? { data: dataNoFuso(m.agendamentos.inicio), clienteNome: m.agendamentos.clientes?.nome ?? "—" }
        : null,
      responsavelNome: m.colaboradores?.nome ?? null,
    })),
    limitado: linhas.length >= LIMITE_MOVIMENTOS,
  };
}

/** Aba Estoque (dona): produtos com estoque, mínimo e custo, e o histórico do período. */
export async function carregarEstoque(
  supabase: Supabase,
  f: { produtoId: string | null; de: string; ate: string },
): Promise<DadosEstoque> {
  const [produtosRes, custosRes, historico] = await Promise.all([
    supabase
      .from("produtos")
      .select("id, nome, unidade, estoque_atual, estoque_minimo, ativo")
      .order("nome", { ascending: true }),
    supabase.from("produtos_custos").select("produto_id, custo_unitario_centavos"),
    carregarMovimentos(supabase, f),
  ]);
  if (produtosRes.error) throw new Error(`Falha ao carregar os produtos: ${produtosRes.error.message}`);
  if (custosRes.error) throw new Error(`Falha ao carregar os custos: ${custosRes.error.message}`);

  const custos = new Map((custosRes.data ?? []).map((c) => [c.produto_id, c.custo_unitario_centavos]));
  const produtos: ProdutoDoEstoque[] = (produtosRes.data ?? [])
    .map((p) => {
      const estoqueAtual = Number(p.estoque_atual);
      const estoqueMinimo = Number(p.estoque_minimo);
      return {
        id: p.id,
        nome: p.nome,
        unidade: p.unidade,
        ativo: p.ativo,
        estoqueAtual,
        estoqueMinimo,
        custoCentavos: custos.get(p.id) ?? 0,
        abaixo: p.ativo && estoqueAtual <= estoqueMinimo,
      };
    })
    // sort é estável: dentro de ativos/inativos fica a ordem por nome do banco.
    .sort((a, b) => Number(b.ativo) - Number(a.ativo));

  const abaixo = produtos
    .filter((p) => p.abaixo)
    .sort(
      (a, b) =>
        a.estoqueAtual - a.estoqueMinimo - (b.estoqueAtual - b.estoqueMinimo) ||
        a.nome.localeCompare(b.nome, "pt-BR"),
    );

  return { produtos, abaixo, ...historico };
}
