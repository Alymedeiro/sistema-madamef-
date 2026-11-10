import "server-only";
import type { FormaPagamento } from "@/lib/dominio/caixa";
import { agrupamento, type CategoriaDespesa } from "@/lib/dominio/financeiro";
import type { createClient } from "@/lib/supabase/server";

type Supabase = Awaited<ReturnType<typeof createClient>>;

export type LinhaFluxo = {
  /** Dia (AAAA-MM-DD) ou 1º dia do mês, conforme o agrupamento. */
  periodo: string;
  entradas: number;
  saidas: number;
  saldo: number;
  acumulado: number;
};

export type Fluxo = {
  agrupar: "dia" | "mes";
  linhas: LinhaFluxo[];
  totais: { entradas: number; saidas: number; saldo: number };
  porForma: { forma: FormaPagamento; total: number }[];
  porCategoria: { categoria: CategoriaDespesa; total: number }[];
};

// bigint do Postgres pode chegar como número ou texto.
const num = (v: unknown) => Number(v ?? 0) || 0;

/** Saldo de cada período e acumulado desde o início de [de, ate]. */
export function montarLinhasFluxo(
  linhas: { periodo: string; entradas: unknown; saidas: unknown }[],
): LinhaFluxo[] {
  let acumulado = 0;
  return linhas.map((l) => {
    const entradas = num(l.entradas);
    const saidas = num(l.saidas);
    const saldo = entradas - saidas;
    acumulado += saldo;
    return { periodo: l.periodo, entradas, saidas, saldo, acumulado };
  });
}

/**
 * Fluxo de caixa de [de, ate] (só dona): por dia, ou por mês quando o período
 * tem mais de 62 dias; totais por forma de pagamento e por categoria de despesa.
 */
export async function carregarFluxo(supabase: Supabase, de: string, ate: string): Promise<Fluxo> {
  const agrupar = agrupamento(de, ate);
  const [fluxo, formas, categorias] = await Promise.all([
    supabase.rpc("fluxo_caixa", { p_de: de, p_ate: ate, p_agrupar: agrupar }),
    supabase.rpc("fluxo_por_forma", { p_de: de, p_ate: ate }),
    supabase.rpc("despesas_por_categoria", { p_de: de, p_ate: ate }),
  ]);
  if (fluxo.error) throw new Error(`Falha ao carregar o fluxo de caixa: ${fluxo.error.message}`);
  if (formas.error) throw new Error(`Falha ao carregar o fluxo por forma: ${formas.error.message}`);
  if (categorias.error) {
    throw new Error(`Falha ao carregar as despesas do fluxo: ${categorias.error.message}`);
  }

  const linhas = montarLinhasFluxo(fluxo.data ?? []);
  const entradas = linhas.reduce((s, l) => s + l.entradas, 0);
  const saidas = linhas.reduce((s, l) => s + l.saidas, 0);
  return {
    agrupar,
    linhas,
    totais: { entradas, saidas, saldo: entradas - saidas },
    porForma: (formas.data ?? []).map((f) => ({ forma: f.forma, total: num(f.total) })),
    porCategoria: (categorias.data ?? []).map((c) => ({ categoria: c.categoria, total: num(c.total) })),
  };
}
