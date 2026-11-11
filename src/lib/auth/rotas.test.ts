import { describe, expect, it } from "vitest";
import { ehRotaPublica } from "./rotas";

describe("ehRotaPublica", () => {
  it("login, esqueci-senha, agendar e confirmar são públicas", () => {
    for (const r of ["/login", "/login/x", "/esqueci-senha", "/auth/confirmar", "/agendar", "/agendar/x", "/api/whatsapp/processar", "/api/webhooks/zapi"]) {
      expect(ehRotaPublica(r)).toBe(true);
    }
  });
  it("definir-senha e o resto exigem sessão", () => {
    for (const r of ["/definir-senha", "/inicio", "/equipe", "/auth", "/auth/outra", "/loginx", "/agendarx", "/api", "/api/outra", "/api/whatsapp", "/api/whatsapp/processarx", "/api/webhooks/zapix"]) {
      expect(ehRotaPublica(r)).toBe(false);
    }
  });
});
