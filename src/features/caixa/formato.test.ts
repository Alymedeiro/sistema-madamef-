import { describe, expect, it } from "vitest";
import { caixasNaoFechados, dataCurta } from "./formato";

describe("caixasNaoFechados", () => {
  const caixas = [
    { id: "hoje", data: "2026-11-04", valor_inicial_centavos: 0, fechado_em: null },
    { id: "ontem", data: "2026-11-03", valor_inicial_centavos: 2000, fechado_em: null },
    { id: "anteontem", data: "2026-11-02", valor_inicial_centavos: 500, fechado_em: null },
    { id: "fechado", data: "2026-11-01", valor_inicial_centavos: 0, fechado_em: "2026-11-01T22:00:00Z" },
  ];
  const pagamentos = [
    { caixa_id: "ontem", forma: "dinheiro", valor_centavos: 3000, desconto_centavos: 500 },
    { caixa_id: "ontem", forma: "pix", valor_centavos: 1000, desconto_centavos: 0 },
    { caixa_id: "hoje", forma: "pix", valor_centavos: 9999, desconto_centavos: 0 },
  ];

  it("só caixas abertos de dias anteriores, do mais antigo ao mais recente, com o resumo", () => {
    const r = caixasNaoFechados(caixas, pagamentos, "2026-11-04");
    expect(r.map((c) => c.id)).toEqual(["anteontem", "ontem"]);
    expect(r[1]).toMatchObject({
      data: "2026-11-03",
      valorInicialCentavos: 2000,
      resumo: { totalGeral: 3500, dinheiroEsperado: 4500 },
    });
    expect(r[1].resumo.totalPorForma.pix).toBe(1000);
    expect(r[0].resumo.totalGeral).toBe(0);
    expect(r[0].resumo.dinheiroEsperado).toBe(500);
  });
});

describe("dataCurta", () => {
  it("yyyy-MM-dd -> dd/MM/yyyy", () => {
    expect(dataCurta("2026-11-03")).toBe("03/11/2026");
  });
});
