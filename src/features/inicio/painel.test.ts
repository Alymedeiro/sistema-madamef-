import { describe, expect, it } from "vitest";
import {
  agruparPorHorario,
  diasDaSemana,
  estoqueBaixo,
  primeiroNome,
  saudacaoPorHora,
} from "./painel";

describe("saudacaoPorHora", () => {
  it("usa a hora de São Paulo", () => {
    expect(saudacaoPorHora(new Date("2026-11-04T14:59:00Z"))).toBe("Bom dia"); // 11:59
    expect(saudacaoPorHora(new Date("2026-11-04T15:00:00Z"))).toBe("Boa tarde"); // 12:00
    expect(saudacaoPorHora(new Date("2026-11-04T20:59:00Z"))).toBe("Boa tarde"); // 17:59
    expect(saudacaoPorHora(new Date("2026-11-04T21:00:00Z"))).toBe("Boa noite"); // 18:00
    expect(saudacaoPorHora(new Date("2026-11-04T02:00:00Z"))).toBe("Boa noite"); // 23:00 do dia 3
    expect(saudacaoPorHora(new Date("2026-11-04T08:00:00Z"))).toBe("Bom dia"); // 05:00
  });
});

describe("primeiroNome", () => {
  it("pega a primeira palavra", () => {
    expect(primeiroNome("  Fernanda Souza ")).toBe("Fernanda");
    expect(primeiroNome("")).toBe("");
  });
});

describe("estoqueBaixo", () => {
  it("só ativos com estoque <= mínimo, mais crítico primeiro", () => {
    const r = estoqueBaixo([
      { id: "1", nome: "A", ativo: true, estoque_atual: 5, estoque_minimo: 5 },
      { id: "2", nome: "B", ativo: true, estoque_atual: 6, estoque_minimo: 5 },
      { id: "3", nome: "C", ativo: false, estoque_atual: 0, estoque_minimo: 5 },
      { id: "4", nome: "D", ativo: true, estoque_atual: 1, estoque_minimo: 5 },
    ]);
    expect(r.map((p) => p.id)).toEqual(["4", "1"]);
  });
});

describe("agruparPorHorario", () => {
  it("ordena pelo início", () => {
    const r = agruparPorHorario([
      { id: "b", inicio: "2026-11-04T17:00:00Z" },
      { id: "a", inicio: "2026-11-04T12:00:00Z" },
    ]);
    expect(r.map((x) => x.id)).toEqual(["a", "b"]);
  });
});

describe("diasDaSemana", () => {
  it("hoje, amanhã e fim da semana (hoje + 6) em São Paulo", () => {
    expect(diasDaSemana(new Date("2026-11-04T02:30:00Z"))).toEqual({
      hoje: "2026-11-03",
      amanha: "2026-11-04",
      fimSemana: "2026-11-09",
    });
    expect(diasDaSemana(new Date("2026-12-29T15:00:00Z")).fimSemana).toBe("2027-01-04");
  });
});
