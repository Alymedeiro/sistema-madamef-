import { describe, expect, it } from "vitest";
import { gerarParcelas, resumoCaixa, ROTULO_FORMA } from "./caixa";

describe("gerarParcelas", () => {
  it("divide R$ 100,00 em 3x sem perder centavos (resto na 1ª parcela)", () => {
    const p = gerarParcelas(10000, 3, "2026-12-03");
    expect(p.map((x) => x.valorCentavos)).toEqual([3334, 3333, 3333]);
    expect(p.reduce((s, x) => s + x.valorCentavos, 0)).toBe(10000);
    expect(p.map((x) => x.numero)).toEqual([1, 2, 3]);
    expect(p.map((x) => x.vencimento)).toEqual(["2026-12-03", "2027-01-03", "2027-02-03"]);
  });

  it("ajusta o dia ao último dia do mês quando não existe", () => {
    expect(gerarParcelas(10000, 3, "2027-01-31").map((p) => p.vencimento)).toEqual([
      "2027-01-31",
      "2027-02-28",
      "2027-03-31",
    ]);
    expect(gerarParcelas(300, 2, "2028-01-30").map((p) => p.vencimento)).toEqual([
      "2028-01-30",
      "2028-02-29",
    ]);
  });

  it("uma parcela devolve o valor inteiro", () => {
    expect(gerarParcelas(5000, 1, "2026-12-03")).toEqual([
      { numero: 1, valorCentavos: 5000, vencimento: "2026-12-03" },
    ]);
  });

  it("rejeita parcelas inválidas", () => {
    expect(() => gerarParcelas(100, 0, "2026-12-03")).toThrow();
    expect(() => gerarParcelas(100, 2, "03/12/2026")).toThrow();
  });
});

describe("resumoCaixa", () => {
  it("soma líquido de desconto por forma e calcula o dinheiro esperado", () => {
    const r = resumoCaixa(5000, [
      { forma: "dinheiro", valorCentavos: 8000, descontoCentavos: 500 },
      { forma: "pix", valorCentavos: 12000, descontoCentavos: 0 },
    ]);
    expect(r.totalPorForma.dinheiro).toBe(7500);
    expect(r.totalPorForma.pix).toBe(12000);
    expect(r.totalPorForma.credito).toBe(0);
    expect(r.totalGeral).toBe(19500);
    expect(r.dinheiroEsperado).toBe(12500);
  });

  it("igual ao fechar_caixa: a_receber fica fora e os recebimentos do dia entram pela forma", () => {
    // Mesmo caso do teste do banco: pix 100,00 + parcela recebida em pix 50,00 + venda a receber 50,00.
    const r = resumoCaixa(
      0,
      [
        { forma: "pix", valorCentavos: 10000, descontoCentavos: 0 },
        { forma: "a_receber", valorCentavos: 5000, descontoCentavos: 0 },
      ],
      [{ forma: "pix", valorCentavos: 5000 }],
    );
    expect(r.totalPorForma.pix).toBe(15000);
    expect(r.totalPorForma.a_receber).toBe(0);
    expect(r.totalGeral).toBe(15000);
    expect(r.vendidoAReceber).toBe(5000);
    expect(r.recebidoParcelas).toBe(5000);
  });

  it("parcela recebida em dinheiro aumenta o dinheiro esperado", () => {
    const r = resumoCaixa(2000, [], [{ forma: "dinheiro", valorCentavos: 3000 }]);
    expect(r.totalPorForma.dinheiro).toBe(3000);
    expect(r.dinheiroEsperado).toBe(5000);
  });

  it("a_receber com desconto: informa o líquido vendido a receber", () => {
    const r = resumoCaixa(0, [{ forma: "a_receber", valorCentavos: 10000, descontoCentavos: 1000 }]);
    expect(r.totalGeral).toBe(0);
    expect(r.vendidoAReceber).toBe(9000);
  });

  it("sem lançamentos, esperado é só o troco inicial", () => {
    const r = resumoCaixa(5000, []);
    expect(r.totalGeral).toBe(0);
    expect(r.dinheiroEsperado).toBe(5000);
  });
});

describe("ROTULO_FORMA", () => {
  it("tem rótulos em português", () => {
    expect(ROTULO_FORMA.credito_parcelado).toBe("Crédito parcelado");
    expect(ROTULO_FORMA.a_receber).toBe("A receber");
  });
});
