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

/** Rota do PDF com a aba, o período e — nas listas — os filtros atuais. */
export function hrefExportarPdf(p: {
  aba: Exclude<AbaFinanceiro, "caixa">;
  periodo: FiltroPeriodo;
  de?: string;
  ate?: string;
  situacao?: string;
  busca?: string;
  categoria?: string;
}): string {
  const q = new URLSearchParams({ aba: p.aba });
  if (p.periodo !== "mes") q.set("periodo", p.periodo);
  if (p.periodo === "personalizado" && p.de && p.ate) {
    q.set("de", p.de);
    q.set("ate", p.ate);
  }
  if (p.aba === "pagar" || p.aba === "receber") {
    if (p.situacao) q.set("situacao", p.situacao);
    if (p.busca) q.set("busca", p.busca);
    if (p.aba === "pagar" && p.categoria) q.set("categoria", p.categoria);
  }
  return `/financeiro/exportar?${q.toString()}`;
}
