import { describe, expect, it } from "vitest";
import {
  baseComissao,
  competenciaDe,
  percentualEfetivo,
  ROTULO_STATUS_COMISSAO,
  valorComissao,
} from "./comissoes";

describe("percentualEfetivo", () => {
  it("serviço prevalece, depois profissional, senão 0", () => {
    expect(percentualEfetivo(30, 10)).toBe(30);
    expect(percentualEfetivo(null, 10)).toBe(10);
    expect(percentualEfetivo(null, null)).toBe(0);
    expect(percentualEfetivo(0, 10)).toBe(0);
  });
});

describe("baseComissao", () => {
  it("pacote: valor total ÷ sessões arredondado", () => {
    expect(
      baseComissao({ pacote: { valorTotal: 100000, totalSessoes: 3 }, valorPrevisto: 1 }),
    ).toBe(33333);
  });
  it("cobrança: bruto − desconto", () => {
    expect(baseComissao({ cobranca: { bruto: 20000, desconto: 5000 }, valorPrevisto: 1 })).toBe(
      15000,
    );
  });
  it("sem cobrança: valor previsto", () => {
    expect(baseComissao({ valorPrevisto: 12000 })).toBe(12000);
  });
});

describe("valorComissao", () => {
  it("arredonda half-up em centavos", () => {
    expect(valorComissao(33333, 12.5)).toBe(4167);
    expect(valorComissao(10000, 30)).toBe(3000);
    expect(valorComissao(1, 50)).toBe(1);
    expect(valorComissao(100, 0)).toBe(0);
  });
});

describe("competenciaDe", () => {
  it("usa o mês em America/Sao_Paulo", () => {
    expect(competenciaDe("2026-12-01T02:30:00Z")).toBe("2026-11-01");
    expect(competenciaDe("2026-12-01T03:00:00Z")).toBe("2026-12-01");
  });
});

describe("ROTULO_STATUS_COMISSAO", () => {
  it("rótulos", () => {
    expect(ROTULO_STATUS_COMISSAO).toEqual({
      aberta: "Em aberto",
      paga: "Paga",
      cancelada: "Cancelada",
    });
  });
});
