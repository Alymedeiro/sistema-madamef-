import { describe, expect, it } from "vitest";
import {
  diferencaAjuste,
  formatarCompetencia,
  ROTULO_TIPO_MOVIMENTO,
  saldoDosMovimentos,
} from "./estoque";

describe("diferencaAjuste", () => {
  it("sem erro de ponto flutuante", () => {
    expect(diferencaAjuste(0.1, 0.3)).toBe(0.2);
    expect(diferencaAjuste(5, 2)).toBe(-3);
    expect(diferencaAjuste(2.5, 2.5)).toBe(0);
  });
});

describe("saldoDosMovimentos", () => {
  it("soma exata", () => {
    expect(saldoDosMovimentos([0.1, 0.2])).toBe(0.3);
    expect(saldoDosMovimentos([10, -1.5, -0.25])).toBe(8.25);
    expect(saldoDosMovimentos([])).toBe(0);
  });
});

describe("rótulos e competência", () => {
  it("tipos de movimento", () => {
    expect(ROTULO_TIPO_MOVIMENTO.baixa_atendimento).toBe("Baixa (atendimento)");
    expect(ROTULO_TIPO_MOVIMENTO.estorno_atendimento).toBe("Estorno (atendimento)");
  });
  it("formatarCompetencia", () => {
    expect(formatarCompetencia("2026-11-01")).toBe("11/2026");
  });
});
