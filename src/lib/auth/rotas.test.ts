import { describe, expect, it } from "vitest";
import { ehRotaPublica } from "./rotas";

describe("ehRotaPublica", () => {
  it("login, esqueci-senha, agendar e confirmar são públicas", () => {
    for (const r of ["/login", "/login/x", "/esqueci-senha", "/auth/confirmar", "/agendar", "/agendar/x"]) {
      expect(ehRotaPublica(r)).toBe(true);
    }
  });
  it("definir-senha e o resto exigem sessão", () => {
    for (const r of ["/definir-senha", "/inicio", "/equipe", "/auth", "/auth/outra", "/loginx", "/agendarx"]) {
      expect(ehRotaPublica(r)).toBe(false);
    }
  });
});
