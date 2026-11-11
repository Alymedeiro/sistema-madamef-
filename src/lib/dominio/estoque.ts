// Regras de estoque. Quantidades têm até 3 casas: trabalha-se em milésimos
// inteiros para não ter erro de ponto flutuante.

export type TipoMovimento = "entrada" | "ajuste" | "baixa_atendimento" | "estorno_atendimento";

export const ROTULO_TIPO_MOVIMENTO: Record<TipoMovimento, string> = {
  entrada: "Entrada",
  ajuste: "Ajuste",
  baixa_atendimento: "Baixa (atendimento)",
  estorno_atendimento: "Estorno (atendimento)",
};

const emMilesimos = (q: number) => Math.round(q * 1000);

/** contada − atual, com 3 casas exatas. */
export function diferencaAjuste(atual: number, contada: number): number {
  return (emMilesimos(contada) - emMilesimos(atual)) / 1000;
}

export function saldoDosMovimentos(qs: number[]): number {
  return qs.reduce((soma, q) => soma + emMilesimos(q), 0) / 1000;
}

/** "2026-11-01" -> "11/2026". */
export function formatarCompetencia(competencia: string): string {
  const [ano, mes] = competencia.split("-");
  return `${mes}/${ano}`;
}
