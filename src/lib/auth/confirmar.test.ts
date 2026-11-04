import { describe, expect, it } from "vitest";
import { lerConfirmacao } from "./confirmar";

const p = (qs: string) => new URLSearchParams(qs);

describe("lerConfirmacao", () => {
  it("aceita token_hash com type invite ou recovery", () => {
    expect(lerConfirmacao(p("token_hash=abc123&type=invite"))).toEqual({
      tokenHash: "abc123",
      tipo: "invite",
    });
    expect(lerConfirmacao(p("token_hash=abc123&type=recovery"))).toEqual({
      tokenHash: "abc123",
      tipo: "recovery",
    });
  });

  it("rejeita qualquer outro type", () => {
    for (const t of ["signup", "magiclink", "email_change", "email", "INVITE", ""]) {
      expect(lerConfirmacao(p(`token_hash=abc123&type=${t}`))).toBeNull();
    }
    expect(lerConfirmacao(p("token_hash=abc123"))).toBeNull();
  });

  it("rejeita token_hash ausente, vazio ou com caracteres estranhos", () => {
    expect(lerConfirmacao(p("type=invite"))).toBeNull();
    expect(lerConfirmacao(p("token_hash=&type=invite"))).toBeNull();
    expect(lerConfirmacao(p("token_hash=%20&type=invite"))).toBeNull();
    expect(lerConfirmacao(p("token_hash=a%2Fb%3Fc&type=invite"))).toBeNull();
    expect(lerConfirmacao(p(`token_hash=${"a".repeat(300)}&type=invite`))).toBeNull();
  });
});
