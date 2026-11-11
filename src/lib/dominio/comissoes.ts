// Regras de comissão (espelham gravar_comissao/base_comissao/percentual_comissao
// da migração 0011). Valores em centavos inteiros; percentual numeric(5,2).

export type StatusComissao = "aberta" | "paga" | "cancelada";

export const ROTULO_STATUS_COMISSAO: Record<StatusComissao, string> = {
  aberta: "Em aberto",
  paga: "Paga",
  cancelada: "Cancelada",
};

/** Percentual do serviço, senão o padrão da profissional, senão 0. */
export function percentualEfetivo(
  servicoPct: number | null,
  profissionalPct: number | null,
): number {
  return servicoPct ?? profissionalPct ?? 0;
}

/** Divisão inteira arredondada half-up (positivos), como round(numeric). */
function dividirArredondando(numerador: number, denominador: number): number {
  return Math.floor((2 * numerador + denominador) / (2 * denominador));
}

export function baseComissao(a: {
  pacote?: { valorTotal: number; totalSessoes: number } | null;
  cobranca?: { bruto: number; desconto: number } | null;
  valorPrevisto: number;
}): number {
  if (a.pacote) return dividirArredondando(a.pacote.valorTotal, a.pacote.totalSessoes);
  if (a.cobranca) return a.cobranca.bruto - a.cobranca.desconto;
  return a.valorPrevisto;
}

/** round(base × pct / 100) em centavos, half-up, sem erro de ponto flutuante. */
export function valorComissao(base: number, pct: number): number {
  const centesimos = Math.round(pct * 100);
  return dividirArredondando(base * centesimos, 10000);
}

const FORMATADOR_MES = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Sao_Paulo",
  year: "numeric",
  month: "2-digit",
});

/** Competência (AAAA-MM-01) do mês de `inicio` em America/Sao_Paulo. */
export function competenciaDe(inicioIso: string): string {
  const partes = FORMATADOR_MES.formatToParts(new Date(inicioIso));
  const ano = partes.find((p) => p.type === "year")?.value;
  const mes = partes.find((p) => p.type === "month")?.value;
  return `${ano}-${mes}-01`;
}
