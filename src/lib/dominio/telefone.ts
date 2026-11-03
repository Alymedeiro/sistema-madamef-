/**
 * Tira a pontuação e o código do país (55) quando presente.
 * 12 ou 13 dígitos começando por 55 são tratados como código do país,
 * porque um número nacional tem no máximo 11 dígitos.
 */
function numeroNacional(entrada: string): string {
  const d = entrada.replace(/\D/g, "");
  return (d.length === 12 || d.length === 13) && d.startsWith("55")
    ? d.slice(2)
    : d;
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
