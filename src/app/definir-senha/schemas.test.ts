import { describe, expect, it } from "vitest";
import { novaSenhaSchema } from "./schemas";

describe("novaSenhaSchema", () => {
  it("aceita senha com 8+ caracteres e confirmação igual", () => {
    expect(novaSenhaSchema.safeParse({ senha: "senha1234", confirmacao: "senha1234" }).success).toBe(true);
  });

  it("rejeita senha curta (menos de 8)", () => {
    const r = novaSenhaSchema.safeParse({ senha: "1234567", confirmacao: "1234567" });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0].message).toMatch(/8 caracteres/);
  });

  it("rejeita confirmação diferente", () => {
    const r = novaSenhaSchema.safeParse({ senha: "senha1234", confirmacao: "senha12345" });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0].message).toMatch(/não conferem/);
  });

  it("rejeita senha acima de 72 caracteres (limite do bcrypt)", () => {
    const longa = "a".repeat(73);
    expect(novaSenhaSchema.safeParse({ senha: longa, confirmacao: longa }).success).toBe(false);
  });
});
