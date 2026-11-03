import { describe, expect, it } from "vitest";
import {
  FUSO,
  combinarDataHora,
  dataNoFuso,
  diaDaSemanaNoFuso,
  formatarNoFuso,
  horaNoFuso,
} from "./tempo";

describe("guarda de fuso do ambiente de teste", () => {
  it("roda com TZ=UTC (vitest.config.ts)", () => {
    expect(new Date("2026-01-01T00:00:00").getTimezoneOffset()).toBe(0);
  });
});

describe("tempo no fuso de São Paulo", () => {
  it("usa America/Sao_Paulo como fuso fixo", () => {
    expect(FUSO).toBe("America/Sao_Paulo");
  });

  it("combina data e hora de São Paulo em um instante UTC", () => {
    const d = combinarDataHora("2026-11-03", "09:00");
    expect(d.toISOString()).toBe("2026-11-03T12:00:00.000Z");
  });

  it("rejeita data ou hora fora do calendário em vez de rolar para outro dia", () => {
    expect(() => combinarDataHora("2026-02-30", "09:00")).toThrow(RangeError);
    expect(() => combinarDataHora("2026-13-01", "09:00")).toThrow(RangeError);
    expect(() => combinarDataHora("2026-11-03", "25:00")).toThrow(RangeError);
    expect(() => combinarDataHora("2026-11-03", "09:60")).toThrow(RangeError);
    expect(() => combinarDataHora("abc", "09:00")).toThrow(RangeError);
  });

  it("mostra a hora de São Paulo mesmo com o aparelho em UTC", () => {
    expect(horaNoFuso("2026-11-04T02:30:00Z")).toBe("23:30");
  });

  it("mostra a data de São Paulo (pode ser o dia anterior em UTC)", () => {
    expect(dataNoFuso("2026-11-04T02:30:00Z")).toBe("2026-11-03");
  });

  it("calcula o dia da semana no fuso de São Paulo (0 = domingo)", () => {
    expect(diaDaSemanaNoFuso("2026-11-04T02:30:00Z")).toBe(2); // terça
  });

  it("formata com padrão date-fns no fuso de São Paulo", () => {
    expect(formatarNoFuso("2026-11-04T02:30:00Z", "dd/MM/yyyy HH:mm")).toBe(
      "03/11/2026 23:30",
    );
  });

  it("aceita Date como entrada", () => {
    expect(horaNoFuso(new Date("2026-11-03T12:00:00Z"))).toBe("09:00");
  });
});
