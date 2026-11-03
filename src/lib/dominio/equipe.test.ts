import { describe, expect, it } from "vitest";
import { podeAlterarAcesso } from "./equipe";

const EU = "id-da-dona";
const OUTRA = "id-da-recepcionista";

describe("podeAlterarAcesso", () => {
  it("a dona não pode desativar a si mesma", () => {
    const r = podeAlterarAcesso(EU, EU, { ativo: false });
    expect(r).toEqual({ ok: false, erro: "Você não pode desativar o seu próprio acesso." });
  });

  it("a dona não pode trocar o próprio perfil para outro que não dona", () => {
    expect(podeAlterarAcesso(EU, EU, { perfil: "recepcao" })).toEqual({
      ok: false,
      erro: "Você não pode remover o seu próprio acesso de dona.",
    });
    expect(podeAlterarAcesso(EU, EU, { perfil: "profissional" }).ok).toBe(false);
  });

  it("a dona pode manter o próprio perfil de dona e se reativar", () => {
    expect(podeAlterarAcesso(EU, EU, { perfil: "dona" })).toEqual({ ok: true });
    expect(podeAlterarAcesso(EU, EU, { ativo: true })).toEqual({ ok: true });
    expect(podeAlterarAcesso(EU, EU, {})).toEqual({ ok: true });
  });

  it("pode desativar e mudar o perfil de outra pessoa", () => {
    expect(podeAlterarAcesso(EU, OUTRA, { ativo: false })).toEqual({ ok: true });
    expect(podeAlterarAcesso(EU, OUTRA, { perfil: "profissional" })).toEqual({ ok: true });
    expect(podeAlterarAcesso(EU, OUTRA, { perfil: "dona", ativo: true })).toEqual({ ok: true });
  });
});
