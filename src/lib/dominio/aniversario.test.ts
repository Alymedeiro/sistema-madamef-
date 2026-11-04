import { describe, expect, it } from "vitest";
import { aniversariantes } from "./aniversario";

const c = (nome: string, dataNascimento: string | null) => ({ nome, dataNascimento });

describe("aniversariantes", () => {
  const bissexta = c("Bi", "2000-02-29");

  it("nascida em 29/02 conta em 28/02 em ano não bissexto", () => {
    expect(aniversariantes([bissexta], "2027-02-28", "2027-02-28")).toEqual([bissexta]);
  });

  it("em ano bissexto aparece só em 29/02", () => {
    expect(aniversariantes([bissexta], "2028-02-28", "2028-02-28")).toEqual([]);
    expect(aniversariantes([bissexta], "2028-02-29", "2028-02-29")).toEqual([bissexta]);
  });

  it("período que vira o ano", () => {
    const x = c("Ana", "1990-01-02");
    const y = c("Bia", "1990-12-29");
    const z = c("Cris", "1990-01-05");
    expect(aniversariantes([x, y, z], "2026-12-29", "2027-01-04")).toEqual([x, y]);
  });

  it("data de nascimento nula nunca aparece", () => {
    expect(aniversariantes([c("Sem", null)], "2026-01-01", "2026-12-31")).toEqual([]);
  });

  it("fora do período não aparece e mantém a ordem de entrada", () => {
    const a = c("A", "1980-11-10");
    const b = c("B", "1980-11-04");
    expect(aniversariantes([a, b], "2026-11-04", "2026-11-10")).toEqual([a, b]);
    expect(aniversariantes([a], "2026-11-04", "2026-11-09")).toEqual([]);
  });
});
