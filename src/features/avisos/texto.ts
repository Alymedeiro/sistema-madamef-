import { formatarBRL } from "@/lib/dominio/dinheiro";
import type { ContaAviso } from "@/lib/dominio/financeiro";

// Módulo puro (sem "use client"): usado por Server e Client Components.

/** Texto do vencimento para qualquer d: "vence em N dias" / "vence amanhã" / "vence hoje" / "vencida há N dias". */
export function textoVencimento(dias: number): string {
  if (dias < 0) return dias === -1 ? "vencida há 1 dia" : `vencida há ${-dias} dias`;
  if (dias === 0) return "vence hoje";
  if (dias === 1) return "vence amanhã";
  return `vence em ${dias} dias`;
}

/** "Aluguel — R$ 3.500,00 — vence em 3 dias" (com a parcela, quando houver). */
export function textoAviso(conta: ContaAviso, texto: string): string {
  const partes = [conta.nome];
  if (conta.parcela) partes.push(conta.parcela);
  partes.push(formatarBRL(conta.valorCentavos), texto);
  return partes.join(" — ");
}

export const contagemBadge = (n: number) => (n > 9 ? "9+" : String(n));
