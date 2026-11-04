// Helpers puros de serviços e produtos: quantidades fracionadas (0,5 ml),
// alerta de estoque baixo e duração legível. Dinheiro fica em dinheiro.ts.

const FORMATO_QUANTIDADE = /^(\d+)(?:[.,](\d+))?$/;

/**
 * Converte texto digitado ("2", "0,5", "1.25") em número. Aceita vírgula ou
 * ponto como separador decimal (não há separador de milhar). Devolve null para
 * vazio, negativo e texto inválido; o limite de casas é do schema.
 */
export function parseQuantidade(texto: string): number | null {
  const m = FORMATO_QUANTIDADE.exec(texto.trim());
  if (!m) return null;
  const n = Number(m[2] ? `${m[1]}.${m[2]}` : m[1]);
  return Number.isFinite(n) ? n : null;
}

/** true quando `n` tem no máximo `casas` casas decimais (tolera erro de ponto flutuante). */
export function temNoMaximoCasas(n: number, casas: number): boolean {
  const fator = 10 ** casas;
  return Math.abs(Math.round(n * fator) - n * fator) < 1e-6;
}

const formatadorQuantidade = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 });

/** 0.5 -> "0,5"; 1000 -> "1.000" (para exibição). */
export function formatarQuantidade(n: number): string {
  return formatadorQuantidade.format(n);
}

/** 0.5 -> "0,5"; 1000 -> "1000" (para preencher campos de texto, sem milhar). */
export function quantidadeParaCampo(n: number): string {
  return String(n).replace(".", ",");
}

/** Estoque baixo = atual estritamente abaixo do mínimo. */
export function estoqueBaixo(atual: number, minimo: number): boolean {
  return atual < minimo;
}

/** 45 -> "45 min"; 90 -> "1 h 30 min"; 120 -> "2 h". */
export function formatarDuracao(minutos: number): string {
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}
