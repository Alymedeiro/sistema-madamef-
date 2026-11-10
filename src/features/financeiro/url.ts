import type { FiltroPeriodo } from "@/lib/dominio/financeiro";
import type { AbaFinanceiro } from "@/lib/dominio/permissoes";

/** Link para /financeiro com aba e período (padrões omitidos). */
export function hrefFinanceiro(p: {
  aba: AbaFinanceiro;
  periodo: FiltroPeriodo;
  de?: string;
  ate?: string;
}): string {
  const q = new URLSearchParams();
  if (p.aba !== "painel") q.set("aba", p.aba);
  if (p.periodo !== "mes") q.set("periodo", p.periodo);
  if (p.periodo === "personalizado" && p.de && p.ate) {
    q.set("de", p.de);
    q.set("ate", p.ate);
  }
  const s = q.toString();
  return s ? `/financeiro?${s}` : "/financeiro";
}
