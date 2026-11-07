import { describe, expect, it } from "vitest";
import { destinoInterno } from "./destino";

const P = "/clientes/x?aba=termos";

describe("destinoInterno", () => {
  it("aceita caminhos internos, com busca", () => {
    expect(destinoInterno("/agenda?data=2026-11-04&visao=dia", P)).toBe("/agenda?data=2026-11-04&visao=dia");
    expect(destinoInterno("/clientes/1?aba=termos", P)).toBe("/clientes/1?aba=termos");
  });

  it("recusa o que pode sair do site", () => {
    for (const ruim of [
      undefined,
      "",
      "//x",
      "/\\x",
      "/\t/evil.com",
      "/\n/evil.com",
      "/\r/evil.com",
      "\t//evil.com",
      "https://evil.com",
      "javascript:alert(1)",
      "evil.com",
      "/\u0000x",
    ]) {
      expect(destinoInterno(ruim, P)).toBe(P);
    }
  });
});
