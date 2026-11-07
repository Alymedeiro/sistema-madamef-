import { describe, expect, it } from "vitest";
import { JANELA_EDICAO_HORAS, podeEditarEvolucao } from "./evolucoes";

const ev = { profissionalId: "p1", criadoEm: "2026-11-03T13:00:00Z" };

describe("podeEditarEvolucao", () => {
  it("janela de 24 horas", () => {
    expect(JANELA_EDICAO_HORAS).toBe(24);
    expect(podeEditarEvolucao(ev, "p1", new Date("2026-11-04T12:59:00Z"))).toBe(true);
    expect(podeEditarEvolucao(ev, "p1", new Date("2026-11-04T13:01:00Z"))).toBe(false);
  });
  it("só a autora edita", () => {
    expect(podeEditarEvolucao(ev, "p2", new Date("2026-11-03T14:00:00Z"))).toBe(false);
  });
  it("data ilegível não permite editar", () => {
    expect(podeEditarEvolucao({ ...ev, criadoEm: "x" }, "p1", new Date())).toBe(false);
  });
});
