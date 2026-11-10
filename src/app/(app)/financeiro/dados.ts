import "server-only";
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
  vencidosQtd: number;
  vencidosTotal: number;
};

const dois = (n: number) => String(n).padStart(2, "0");

/** Último dia do mês seguinte ao de `hoje` (AAAA-MM-DD). */
export function fimDoMesSeguinte(hoje: string): string {
  const [ano, mes] = hoje.split("-").map(Number);
  // Date.UTC(ano, mes + 1, 0): dia 0 do mês após o seguinte = último dia do seguinte.
  const d = new Date(Date.UTC(ano, mes + 1, 0));
  return `${d.getUTCFullYear()}-${dois(d.getUTCMonth() + 1)}-${dois(d.getUTCDate())}`;
}

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
