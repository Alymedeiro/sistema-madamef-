import { describe, expect, it } from "vitest";
import { emailRecuperacaoSchema } from "./schemas";

describe("emailRecuperacaoSchema", () => {
  it("normaliza e aceita e-mail válido", () => {
    const r = emailRecuperacaoSchema.safeParse("  Ana@MadameFe.com.br ");
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toBe("ana@madamefe.com.br");
  });
  it("rejeita e-mail inválido", () => {
    expect(emailRecuperacaoSchema.safeParse("ana@").success).toBe(false);
    expect(emailRecuperacaoSchema.safeParse("").success).toBe(false);
  });
});
