import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Resumo } from "@/app/(app)/financeiro/dados";
import { CartoesFinanceiro } from "./cartoes";

const RESUMO: Resumo = {
  recebido: 100000,
  recebidoQtd: 3,
  pago: 40000,
  pagoQtd: 2,
  aReceber: 25000,
  jaRecebido: 5000,
  aPagar: 10000,
  jaPago: 2000,
  aReceberVencido: 0,
  aPagarVencido: 0,
  vencidosQtd: 1,
  vencidosTotal: 7000,
};

const html = (resumo: Resumo | null) =>
  renderToStaticMarkup(CartoesFinanceiro({ resumo })).replace(/ /g, " ");

describe("CartoesFinanceiro", () => {
  it("sem resumo: os 7 cartões em 'Indisponível no momento', sem valores", () => {
    const h = html(null);
    for (const t of ["Recebido", "Pago", "Saldo em caixa", "A receber", "A pagar", "Saldo projetado", "Vencidos"]) {
      expect(h).toContain(`aria-label="${t}"`);
    }
    expect(h.match(/Indisponível no momento/g)).toHaveLength(7);
    expect(h).not.toContain("R$");
  });

  it("com resumo: valores e detalhes", () => {
    const h = html(RESUMO);
    expect(h).toContain("R$ 1.000,00");
    expect(h).toContain("já recebido: R$ 50,00");
    expect(h).toContain("já pago: R$ 20,00");
    expect(h).not.toContain("vencidos");
    expect(h).not.toContain("Indisponível");
  });
});
