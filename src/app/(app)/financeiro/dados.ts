import "server-only";
import {
  CATEGORIAS_DESPESA,
  consultaDaSituacao,
  fimDoMesSeguinte,
  MAX_LINHAS_LISTA,
  situacaoConta,
  type CategoriaDespesa,
  type FiltroSituacao,
} from "@/lib/dominio/financeiro";
import { dataNoFuso } from "@/lib/dominio/tempo";
import type { createClient } from "@/lib/supabase/server";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** Os números dos 7 cartões (centavos e quantidades), vindos de `resumo_financeiro`. */
export type Resumo = {
  recebido: number;
  recebidoQtd: number;
  pago: number;
  pagoQtd: number;
  aReceber: number;
  jaRecebido: number;
  aPagar: number;
  jaPago: number;
  /** Parte de aReceber / aPagar com vencimento < hoje. */
  aReceberVencido: number;
  aPagarVencido: number;
  vencidosQtd: number;
  vencidosTotal: number;
};

const dois = (n: number) => String(n).padStart(2, "0");

export { fimDoMesSeguinte };

/** Datas no formato AAAA-MM-DD somadas de `dias`. */
function somarDias(data: string, dias: number): string {
  const [a, m, d] = data.split("-").map(Number);
  const r = new Date(Date.UTC(a, m - 1, d + dias));
  return `${r.getUTCFullYear()}-${dois(r.getUTCMonth() + 1)}-${dois(r.getUTCDate())}`;
}

// bigint do Postgres pode chegar como número ou texto.
const num = (v: unknown) => Number(v ?? 0) || 0;

/**
 * Resumo do período [de, ate]. Antes gera as contas fixas até o fim do mês
 * seguinte (idempotente) para que A pagar já as inclua. Só para a dona: as duas
 * RPCs recusam outros perfis ("Acesso não autorizado").
 */
export async function carregarResumo(
  supabase: Supabase,
  de: string,
  ate: string,
  agora: Date = new Date(),
): Promise<Resumo> {
  const gerar = await supabase.rpc("gerar_contas_fixas", {
    p_ate: fimDoMesSeguinte(dataNoFuso(agora)),
  });
  if (gerar.error) throw new Error(`Falha ao gerar as contas fixas: ${gerar.error.message}`);

  const { data, error } = await supabase.rpc("resumo_financeiro", { p_de: de, p_ate: ate });
  if (error) throw new Error(`Falha ao carregar o resumo financeiro: ${error.message}`);
  const linha = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | undefined;
  const l = linha ?? {};
  return {
    recebido: num(l.recebido),
    recebidoQtd: num(l.recebido_qtd),
    pago: num(l.pago),
    pagoQtd: num(l.pago_qtd),
    aReceber: num(l.a_receber),
    jaRecebido: num(l.ja_recebido),
    aPagar: num(l.a_pagar),
    jaPago: num(l.ja_pago),
    aReceberVencido: num(l.a_receber_vencido),
    aPagarVencido: num(l.a_pagar_vencido),
    vencidosQtd: num(l.vencidos_qtd),
    vencidosTotal: num(l.vencidos_total),
  };
}

export type ProximoVencimento = {
  tipo: "pagar" | "receber";
  id: string;
  /** Descrição da conta a pagar ou nome da cliente. */
  nome: string;
  /** "parcela n/N" ou a descrição da conta a receber manual. */
  detalhe: string | null;
  valorCentavos: number;
  vencimento: string;
};

/** Contas em aberto (pagar e receber) vencendo de hoje a hoje + 7 dias. Só dona. */
export async function carregarProximosVencimentos(
  supabase: Supabase,
  hoje: string,
): Promise<ProximoVencimento[]> {
  const ate = somarDias(hoje, 7);
  const [pagar, receber] = await Promise.all([
    supabase
      .from("contas_pagar")
      .select("id, descricao, valor_centavos, vencimento")
      .eq("status", "aberta")
      .gte("vencimento", hoje)
      .lte("vencimento", ate)
      .order("vencimento"),
    supabase
      .from("contas_receber")
      .select("id, descricao, valor_centavos, vencimento, numero, total_parcelas, clientes(nome)")
      .is("recebido_em", null)
      .is("cancelada_em", null)
      .gte("vencimento", hoje)
      .lte("vencimento", ate)
      .order("vencimento"),
  ]);
  if (pagar.error) throw new Error(`Falha ao carregar as contas a pagar: ${pagar.error.message}`);
  if (receber.error) throw new Error(`Falha ao carregar as contas a receber: ${receber.error.message}`);

  const itens: ProximoVencimento[] = [
    ...(pagar.data ?? []).map((c) => ({
      tipo: "pagar" as const,
      id: c.id,
      nome: c.descricao,
      detalhe: null,
      valorCentavos: c.valor_centavos,
      vencimento: c.vencimento,
    })),
    ...(receber.data ?? []).map((c) => ({
      tipo: "receber" as const,
      id: c.id,
      nome: c.clientes?.nome ?? "—",
      detalhe: c.descricao ?? `parcela ${c.numero}/${c.total_parcelas}`,
      valorCentavos: c.valor_centavos,
      vencimento: c.vencimento,
    })),
  ];
  return itens.sort((a, b) => a.vencimento.localeCompare(b.vencimento));
}

export type ContaPagarLinha = {
  id: string;
  descricao: string;
  categoria: CategoriaDespesa;
  /** Fornecedor ou, no vale, a colaboradora. */
  quem: string | null;
  fornecedor: string | null;
  valorCentavos: number;
  vencimento: string;
  status: "aberta" | "paga" | "cancelada";
  situacao: ReturnType<typeof situacaoConta>;
  pagoEm: string | null;
  forma: string | null;
  anexoPath: string | null;
  /** Gerada por uma conta fixa. */
  fixa: boolean;
};

const MAX_LINHAS = MAX_LINHAS_LISTA;

/** Tira da busca o que quebraria o filtro do PostgREST (vírgula, parênteses, curingas). */
function termoBusca(busca: string | undefined): string {
  return (busca ?? "").replace(/[,()%*\\:"]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
}

/**
 * Contas a pagar da aba (só dona, por RLS). Situação conforme
 * `consultaDaSituacao` (padrão "Em aberto", sem as vencidas).
 */
export async function listarContasPagar(
  supabase: Supabase,
  f: { de: string; ate: string; situacao?: FiltroSituacao; busca?: string; categoria?: string },
  hoje: string = dataNoFuso(new Date()),
): Promise<ContaPagarLinha[]> {
  const c = consultaDaSituacao(f.situacao ?? "aberta", f, hoje);
  // Intervalo vazio (ex.: "Em aberto" no mês passado): nada a consultar.
  if (c.gte && c.lte && c.gte > c.lte) return [];
  let q = supabase
    .from("contas_pagar")
    .select(
      "id, descricao, categoria, fornecedor, valor_centavos, vencimento, status, pago_em, forma, anexo_path, conta_fixa_id, colaborador:colaboradores!contas_pagar_colaborador_id_fkey(nome)",
    );

  const coluna = c.coluna === "pagamento" ? "pago_em" : "vencimento";
  if (c.status) q = q.eq("status", c.status);
  if (c.gte) q = q.gte(coluna, c.gte);
  if (c.lte) q = q.lte(coluna, c.lte);
  if (c.lt) q = q.lt(coluna, c.lt);

  const termo = termoBusca(f.busca);
  if (termo) q = q.or(`descricao.ilike.%${termo}%,fornecedor.ilike.%${termo}%`);
  if (CATEGORIAS_DESPESA.includes(f.categoria as CategoriaDespesa)) {
    q = q.eq("categoria", f.categoria as CategoriaDespesa);
  }

  const { data, error } = await q.order("vencimento").limit(MAX_LINHAS);
  if (error) throw new Error(`Falha ao carregar as contas a pagar: ${error.message}`);

  return (data ?? []).map((c) => {
    const colaborador = (c as { colaborador?: { nome: string } | null }).colaborador;
    return {
      id: c.id,
      descricao: c.descricao,
      categoria: c.categoria,
      quem: colaborador?.nome ?? c.fornecedor,
      fornecedor: c.fornecedor,
      valorCentavos: c.valor_centavos,
      vencimento: c.vencimento,
      status: c.status,
      situacao: situacaoConta(c, hoje),
      pagoEm: c.pago_em,
      forma: c.forma,
      anexoPath: c.anexo_path,
      fixa: c.conta_fixa_id !== null,
    };
  });
}

export type ContaFixaLinha = {
  id: string;
  descricao: string;
  categoria: CategoriaDespesa;
  valorCentavos: number;
  dia: number;
};

/** Contas fixas ativas (só dona). */
export async function listarContasFixas(supabase: Supabase): Promise<ContaFixaLinha[]> {
  const { data, error } = await supabase
    .from("contas_fixas")
    .select("id, descricao, categoria, valor_centavos, dia_vencimento")
    .eq("ativa", true)
    .order("descricao");
  if (error) throw new Error(`Falha ao carregar as contas fixas: ${error.message}`);
  return (data ?? []).map((c) => ({
    id: c.id,
    descricao: c.descricao,
    categoria: c.categoria,
    valorCentavos: c.valor_centavos,
    dia: c.dia_vencimento,
  }));
}

export type ColaboradoraOpcao = { id: string; nome: string };

/** Colaboradoras ativas para o vale. */
export async function listarColaboradorasAtivas(supabase: Supabase): Promise<ColaboradoraOpcao[]> {
  const { data, error } = await supabase
    .from("colaboradores")
    .select("id, nome")
    .eq("ativo", true)
    .order("nome");
  if (error) throw new Error(`Falha ao carregar a equipe: ${error.message}`);
  return (data ?? []).map((c) => ({ id: c.id, nome: c.nome }));
}
