/**
 * Tira a pontuação, o código do país (55) e o 0 de tronco quando presentes.
 * 12 ou 13 dígitos começando por 55 são tratados como código do país,
 * porque um número nacional tem no máximo 11 dígitos. Um único 0 inicial
 * (discagem "011 98765-4321") também é descartado; DDD nunca começa com 0.
 */
function numeroNacional(entrada: string): string {
  const d = entrada.replace(/\D/g, "");
  if ((d.length === 12 || d.length === 13) && d.startsWith("55")) return d.slice(2);
  return d.startsWith("0") ? d.slice(1) : d;
}

/**
 * Normaliza para WhatsApp: "55" + DDD + número, só dígitos.
 * Aceita 10 (fixo) ou 11 (celular) dígitos nacionais, com ou sem 55.
 * Retorna null quando não tem DDD ou o tamanho é inválido.
 */
export function normalizarWhatsApp(entrada: string): string | null {
  const n = numeroNacional(entrada);
  if ((n.length !== 10 && n.length !== 11) || n.startsWith("0")) return null;
  return `55${n}`;
}

/** "5511987654321" -> "(11) 98765-4321". Número não reconhecido volta sem alterar. */
export function formatarTelefone(normalizado: string): string {
  const n = numeroNacional(normalizado);
  if (n.length === 11) return n.replace(/(\d{2})(\d{5})(\d{4})/, "($1) $2-$3");
  if (n.length === 10) return n.replace(/(\d{2})(\d{4})(\d{4})/, "($1) $2-$3");
  return normalizado;
}
