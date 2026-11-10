import { describe, expect, it } from "vitest";
import { hrefFinanceiro } from "./url";

describe("hrefFinanceiro", () => {
  it("mantém a aba e o período; omite padrões e vazios", () => {
    expect(hrefFinanceiro({ aba: "painel", periodo: "mes" })).toBe("/financeiro");
    expect(hrefFinanceiro({ aba: "pagar", periodo: "ano" })).toBe("/financeiro?aba=pagar&periodo=ano");
    expect(
      hrefFinanceiro({ aba: "fluxo", periodo: "personalizado", de: "2026-01-01", ate: "2026-03-31" }),
    ).toBe("/financeiro?aba=fluxo&periodo=personalizado&de=2026-01-01&ate=2026-03-31");
  });

  it("de/até só acompanham o personalizado", () => {
    expect(hrefFinanceiro({ aba: "painel", periodo: "tudo", de: "2026-01-01", ate: "2026-02-01" })).toBe(
      "/financeiro?periodo=tudo",
    );
  });
});
