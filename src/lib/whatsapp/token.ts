import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Compara dois segredos em tempo constante. Os dois lados passam por SHA-256
 * antes, para o tamanho do token esperado não vazar pelo tempo de resposta.
 * Esperado vazio/ausente nunca confere.
 */
export function tokenConfere(recebido: string | null | undefined, esperado: string | null | undefined): boolean {
  if (!esperado || !recebido) return false;
  const a = createHash("sha256").update(recebido).digest();
  const b = createHash("sha256").update(esperado).digest();
  return timingSafeEqual(a, b);
}
