// Valores monetários são sempre inteiros em centavos (domínio e banco).

const formatador = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

/** 123456 -> "R$ 1.234,56" (espaço ASCII após R$, sem NBSP). */
export function formatarBRL(centavos: number): string {
  return formatador.format(centavos / 100).replace(/[  ]/g, " ");
}

// Milhar com pontos bem agrupados, vírgula decimal opcional com 0–2 dígitos.
const FORMATO_BR = /^(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{0,2}))?$/;

/**
 * Converte texto digitado em formato brasileiro para centavos.
 * Aceita "R$" opcional. Retorna null para vazio, negativos e texto inválido.
 * Ponto decimal (ex.: "1234.56") é recusado para não gerar valor errado.
 */
export function parseBRL(texto: string): number | null {
  const limpo = texto.trim().replace(/^R\$\s*/i, "");
  const m = FORMATO_BR.exec(limpo);
  if (!m) return null;

  const reais = Number(m[1].replace(/\./g, ""));
  const centavos = Number((m[2] ?? "").padEnd(2, "0"));
  const total = reais * 100 + centavos;
  return Number.isSafeInteger(total) ? total : null;
}
