import { describe, expect, it } from "vitest";
import { trocarSenhaSchema } from "./schemas";

const ok = { email: "a@b.com", atual: "antiga123", senha: "novasenha1", confirmacao: "novasenha1" };

describe("trocarSenhaSchema", () => {
  it("aceita dados válidos", () => {
    expect(trocarSenhaSchema.safeParse(ok).success).toBe(true);
  });
  it("recusa nova curta, confirmação diferente e nova igual à atual", () => {
    const erro = (v: object) => trocarSenhaSchema.safeParse({ ...ok, ...v }).error?.issues[0].message;
    expect(erro({ senha: "curta", confirmacao: "curta" })).toBe("A senha precisa ter pelo menos 8 caracteres.");
    expect(erro({ confirmacao: "outra1234" })).toBe("As senhas não conferem.");
    expect(erro({ atual: "novasenha1" })).toBe("A nova senha precisa ser diferente da atual.");
    expect(erro({ email: "x" })).toBe("E-mail inválido.");
  });
});
