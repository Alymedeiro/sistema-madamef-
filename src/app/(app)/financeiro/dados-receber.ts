import "server-only";
import { limitesDoDia } from "@/features/agenda/contexto";
import type { FormaPagamento } from "@/lib/dominio/caixa";
import { consultaDaSituacao, situacaoConta, type FiltroSituacao } from "@/lib/dominio/financeiro";
import { dataNoFuso, formatarNoFuso } from "@/lib/dominio/tempo";
import type { createClient } from "@/lib/supabase/server";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** De onde veio a conta: o pagamento que a gerou (atendimento, pacote, produto) ou manual. */
export type OrigemReceber = "agendamento" | "pacote" | "venda_produto" | "manual";

export type ContaReceberLinha = {
  id: string;
  clienteNome: string;
  /** Descrição da conta manual (as parcelas de pagamento não têm). */
  descricao: string | null;
  origem: OrigemReceber;
  /** "n/N". */
  parcela: string;
  valorCentavos: number;
  vencimento: string;
  situacao: ReturnType<typeof situacaoConta>;
  /** Dia (SP) em que foi recebida. */
  recebidoEm: string | null;
  /** Em aberto (pode receber ou cancelar). */
  aberta: boolean;
};

type LinhaBanco = {
  id: string;
  descricao: string | null;
  numero: number;
  total_parcelas: number;
  valor_centavos: number;
  vencimento: string;
  recebido_em: string | null;
  cancelada_em: string | null;
  origem_manual: boolean;
  clientes: { nome: string } | null;
  pagamento?: { origem: Exclude<OrigemReceber, "manual"> } | null;
};

const COLUNAS =
  "id, cliente_id, descricao, numero, total_parcelas, valor_centavos, vencimento, recebido_em, cancelada_em, origem_manual, clientes(nome)";
const MAX_LINHAS = 500;

function paraLinha(c: LinhaBanco, hoje: string): ContaReceberLinha {
  const status = c.cancelada_em ? "cancelada" : c.recebido_em ? "paga" : "aberta";
  return {
    id: c.id,
    clienteNome: c.clientes?.nome ?? "—",
    descricao: c.descricao,
    origem: c.origem_manual ? "manual" : (c.pagamento?.origem ?? "agendamento"),
    parcela: `${c.numero}/${c.total_parcelas}`,
    valorCentavos: c.valor_centavos,
    vencimento: c.vencimento,
    situacao: situacaoConta({ status, vencimento: c.vencimento }, hoje),
    recebidoEm: c.recebido_em ? dataNoFuso(c.recebido_em) : null,
    aberta: status === "aberta",
  };
}

/** Tira da busca o que quebraria o filtro do PostgREST (vírgula, parênteses, curingas). */
function termoBusca(busca: string | undefined): string {
  return (busca ?? "").replace(/[,()%*\\:"]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
}

/**
 * Contas a receber da aba (dona). Situação conforme `consultaDaSituacao`:
 * "aberta" = sem recebimento nem cancelamento; "Recebidas" pelo dia (SP) do
 * recebimento. Busca no nome da cliente ou na descrição.
 */
export async function listarContasReceber(
  supabase: Supabase,
  f: { de: string; ate: string; situacao?: FiltroSituacao; busca?: string },
  hoje: string = dataNoFuso(new Date()),
): Promise<ContaReceberLinha[]> {
  const c = consultaDaSituacao(f.situacao ?? "aberta", f, hoje);
  if (c.gte && c.lte && c.gte > c.lte) return [];

  const termo = termoBusca(f.busca);
  let clientesDaBusca: string[] = [];
  if (termo) {
    const { data, error } = await supabase
      .from("clientes")
      .select("id")
      .ilike("nome", `%${termo}%`)
      .limit(200);
    if (error) throw new Error(`Falha ao buscar as clientes: ${error.message}`);
    clientesDaBusca = (data ?? []).map((x) => x.id);
  }

  let q = supabase
    .from("contas_receber")
    .select(`${COLUNAS}, pagamento:pagamentos!contas_receber_pagamento_id_fkey(origem)`);

  if (c.status === "aberta") q = q.is("recebido_em", null).is("cancelada_em", null);
  if (c.status === "paga") q = q.not("recebido_em", "is", null);
  if (c.status === "cancelada") q = q.not("cancelada_em", "is", null);

  if (c.coluna === "pagamento") {
    // recebido_em é instante: o período vira [00:00 de `de`, 00:00 do dia após `ate`) em SP.
    if (c.gte) q = q.gte("recebido_em", limitesDoDia(c.gte).inicio.toISOString());
    if (c.lte) q = q.lt("recebido_em", limitesDoDia(c.lte).fim.toISOString());
  } else {
    if (c.gte) q = q.gte("vencimento", c.gte);
    if (c.lte) q = q.lte("vencimento", c.lte);
    if (c.lt) q = q.lt("vencimento", c.lt);
  }

  if (termo) {
    const porCliente = clientesDaBusca.length > 0 ? `,cliente_id.in.(${clientesDaBusca.join(",")})` : "";
    q = q.or(`descricao.ilike.%${termo}%${porCliente}`);
  }

  const { data, error } = await q.order("vencimento").order("numero").limit(MAX_LINHAS);
  if (error) throw new Error(`Falha ao carregar as contas a receber: ${error.message}`);
  return ((data ?? []) as unknown as LinhaBanco[]).map((l) => paraLinha(l, hoje));
}

/**
 * Bloco "Parcelas a receber hoje e vencidas" do Caixa do dia (dona e recepção;
 * o RLS da recepção já mostra só estas).
 */
export async function listarParcelasAReceber(
  supabase: Supabase,
  hoje: string,
): Promise<ContaReceberLinha[]> {
  const { data, error } = await supabase
    .from("contas_receber")
    .select(COLUNAS)
    .is("recebido_em", null)
    .is("cancelada_em", null)
    .lte("vencimento", hoje)
    .order("vencimento")
    .order("numero")
    .limit(200);
  if (error) throw new Error(`Falha ao carregar as parcelas a receber: ${error.message}`);
  return ((data ?? []) as unknown as LinhaBanco[]).map((l) => paraLinha(l, hoje));
}

export type RecebimentoDoCaixa = {
  id: string;
  caixaId: string;
  forma: FormaPagamento;
  valorCentavos: number;
  hora: string;
  clienteNome: string;
  parcela: string;
};

/** Parcelas recebidas nos caixas (para o resumo e o fechamento). */
export async function listarRecebimentosDosCaixas(
  supabase: Supabase,
  caixaIds: string[],
): Promise<RecebimentoDoCaixa[]> {
  if (caixaIds.length === 0) return [];
  const { data, error } = await supabase
    .from("recebimentos")
    .select(
      "id, caixa_id, forma, valor_centavos, recebido_em, contas_receber(numero, total_parcelas, descricao, clientes(nome))",
    )
    .in("caixa_id", caixaIds)
    .order("recebido_em");
  if (error) throw new Error(`Falha ao carregar as parcelas recebidas: ${error.message}`);
  return (data ?? []).map((r) => ({
    id: r.id,
    caixaId: r.caixa_id,
    forma: r.forma,
    valorCentavos: r.valor_centavos,
    hora: formatarNoFuso(r.recebido_em, "HH:mm"),
    clienteNome: r.contas_receber?.clientes?.nome ?? "—",
    parcela: r.contas_receber ? `${r.contas_receber.numero}/${r.contas_receber.total_parcelas}` : "—",
  }));
}
