import { describe, expect, it } from "vitest";
import { contagemBadge, textoAviso, textoVencimento } from "./texto";

describe("textoVencimento", () => {
  it.each([
    [-10, "vencida há 10 dias"],
    [-1, "vencida há 1 dia"],
    [0, "vence hoje"],
    [1, "vence amanhã"],
    [5, "vence em 5 dias"],
    [7, "vence em 7 dias"],
  ])("%i", (d, t) => expect(textoVencimento(d)).toBe(t));
});

describe("textoAviso / contagemBadge", () => {
  it("nome — [parcela —] valor — texto", () => {
    const base = { tipo: "pagar" as const, id: "1", nome: "Aluguel", valorCentavos: 350000, vencimento: "2026-11-13" };
    expect(textoAviso(base, "vence em 3 dias")).toMatch(/^Aluguel — R\$\s3\.500,00 — vence em 3 dias$/);
    expect(textoAviso({ ...base, nome: "Maria Silva", parcela: "parcela 2/3" }, "x")).toContain(
      "Maria Silva — parcela 2/3 — ",
    );
  });
  it("máx. 9+", () => {
    expect([0, 9, 10].map(contagemBadge)).toEqual(["0", "9", "9+"]);
  });
});
