import { describe, expect, it } from "vitest";
import {
  erroDasPartes,
  MAX_PARTES,
  partesParaRpc,
  saldoCobranca,
  valorSugeridoNovaParte,
  type ParteCobranca,
} from "./cobranca";

const pix = (valorCentavos: number): ParteCobranca => ({ forma: "pix", valorCentavos, parcelas: 1 });

describe("saldoCobranca (Review Focus 5: centavos)", () => {
  it("R$ 100,00 em 3 formas fecha exato", () => {
    expect(saldoCobranca(10000, [3334, 3333, 3333])).toEqual({
      pagoCentavos: 10000,
      faltaCentavos: 0,
      sobraCentavos: 0,
      fecha: true,
    });
  });

  it("falta R$ 0,01 até fechar exato", () => {
    expect(saldoCobranca(10000, [5000, 4999])).toMatchObject({ faltaCentavos: 1, fecha: false });
    expect(saldoCobranca(10000, [3333, 3333, 3333])).toMatchObject({
      pagoCentavos: 9999,
      faltaCentavos: 1,
      sobraCentavos: 0,
      fecha: false,
    });
  });

  it("sobra quando passa do líquido", () => {
    expect(saldoCobranca(10000, [6000, 5000])).toMatchObject({
      faltaCentavos: 0,
      sobraCentavos: 1000,
      fecha: false,
    });
  });

  it("campo inválido (null) conta 0 e impede fechar", () => {
    expect(saldoCobranca(10000, [10000, null]).fecha).toBe(false);
    expect(saldoCobranca(10000, [6000, null])).toMatchObject({ pagoCentavos: 6000, faltaCentavos: 4000 });
  });

  it("sem partes não fecha", () => {
    expect(saldoCobranca(10000, []).fecha).toBe(false);
  });
});

describe("valorSugeridoNovaParte", () => {
  it("sugere o que falta", () => {
    expect(valorSugeridoNovaParte(10000, [6000])).toBe(4000);
    expect(valorSugeridoNovaParte(10000, [6000, null])).toBe(4000);
  });

  it("nunca é negativo", () => {
    expect(valorSugeridoNovaParte(10000, [12000])).toBe(0);
  });
});

describe("erroDasPartes", () => {
  it("MAX_PARTES é 4", () => {
    expect(MAX_PARTES).toBe(4);
  });

  it("de 1 a 4 formas", () => {
    expect(erroDasPartes(10000, Array(5).fill({ forma: "pix", valorCentavos: 2000, parcelas: 1 }))).toBe(
      "Informe de 1 a 4 formas de pagamento.",
    );
    expect(erroDasPartes(10000, [])).toBe("Informe de 1 a 4 formas de pagamento.");
  });

  it("cada parte maior que zero", () => {
    expect(
      erroDasPartes(10000, [
        { forma: "pix", valorCentavos: 10000, parcelas: 1 },
        { forma: "dinheiro", valorCentavos: 0, parcelas: 1 },
      ]),
    ).toBe("Cada forma de pagamento deve ter valor maior que zero.");
  });

  it("soma igual ao total com desconto", () => {
    expect(erroDasPartes(10000, [{ forma: "pix", valorCentavos: 9999, parcelas: 1 }])).toBe(
      "A soma das formas de pagamento deve ser igual ao total com desconto.",
    );
    expect(erroDasPartes(10000, [pix(3334), pix(3333), pix(3333)])).toBeNull();
  });

  it("parcelas de 2 a 12 nas formas parceladas", () => {
    expect(erroDasPartes(10000, [{ forma: "credito_parcelado", valorCentavos: 10000, parcelas: 1 }])).toBe(
      "Informe de 2 a 12 parcelas.",
    );
    expect(erroDasPartes(10000, [{ forma: "credito_parcelado", valorCentavos: 10000, parcelas: 13 }])).toBe(
      "Informe de 2 a 12 parcelas.",
    );
    expect(
      erroDasPartes(10000, [{ forma: "credito_parcelado", valorCentavos: 10000, parcelas: 12 }]),
    ).toBeNull();
  });

  it("a receber exige o primeiro vencimento", () => {
    expect(erroDasPartes(10000, [{ forma: "a_receber", valorCentavos: 10000, parcelas: 2 }])).toBe(
      "Informe o primeiro vencimento.",
    );
    expect(
      erroDasPartes(10000, [
        { forma: "a_receber", valorCentavos: 10000, parcelas: 2, primeiroVencimento: "2026-02-30" },
      ]),
    ).toBe("Informe o primeiro vencimento.");
    expect(
      erroDasPartes(10000, [
        pix(7000),
        { forma: "a_receber", valorCentavos: 3000, parcelas: 3, primeiroVencimento: "2026-12-03" },
      ]),
    ).toBeNull();
  });
});

describe("partesParaRpc", () => {
  it("a receber de R$ 30,00 em 3x: parcelas somam a parte", () => {
    expect(
      partesParaRpc([{ forma: "a_receber", valorCentavos: 3000, parcelas: 3, primeiroVencimento: "2026-12-03" }]),
    ).toEqual([
      {
        forma: "a_receber",
        valor_centavos: 3000,
        parcelas: 3,
        vencimentos: ["2026-12-03", "2027-01-03", "2027-02-03"],
        valores_parcelas: [1000, 1000, 1000],
      },
    ]);
  });

  it("a receber com resto: o centavo vai para a 1ª parcela e a soma fecha", () => {
    const [p] = partesParaRpc([
      { forma: "a_receber", valorCentavos: 10000, parcelas: 3, primeiroVencimento: "2026-12-03" },
    ]);
    expect(p.valores_parcelas).toEqual([3334, 3333, 3333]);
    expect(p.valores_parcelas!.reduce((a, b) => a + b, 0)).toBe(10000);
  });

  it("formas não parceladas vão com 1 parcela e sem vencimentos", () => {
    expect(partesParaRpc([{ forma: "pix", valorCentavos: 100, parcelas: 1 }])[0]).toMatchObject({
      vencimentos: null,
      valores_parcelas: null,
    });
    expect(partesParaRpc([{ forma: "dinheiro", valorCentavos: 100, parcelas: 5 }])[0]).toEqual({
      forma: "dinheiro",
      valor_centavos: 100,
      parcelas: 1,
      vencimentos: null,
      valores_parcelas: null,
    });
  });

  it("crédito parcelado mantém as parcelas, sem vencimentos", () => {
    expect(partesParaRpc([{ forma: "credito_parcelado", valorCentavos: 9000, parcelas: 3 }])[0]).toEqual({
      forma: "credito_parcelado",
      valor_centavos: 9000,
      parcelas: 3,
      vencimentos: null,
      valores_parcelas: null,
    });
  });
});
