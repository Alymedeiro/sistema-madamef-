import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Perfil } from "@/lib/dominio/permissoes";
import { criarSupabaseFalso } from "@/test/supabase-falso";

let perfilAtual: Perfil = "dona";
const exigirPerfil = vi.fn(async (...perfis: Perfil[]) => {
  if (perfis.length > 0 && !perfis.includes(perfilAtual)) throw new Error("REDIRECT:/inicio");
  return { userId: "u1", colaborador: { id: "c1", nome: "Fê", perfil: perfilAtual } };
});
vi.mock("@/lib/sessao", () => ({ exigirPerfil: (...p: Perfil[]) => exigirPerfil(...p) }));
const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => revalidatePath(...a) }));

let falso = criarSupabaseFalso();
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => falso.cliente }));

import { pagarComissoes } from "./actions-comissoes";

const PROF = "a0000000-0000-4000-8000-0000000000a1";
const entrada = { profissionalId: PROF, competencia: "2026-11-01", pagoEm: "2026-11-10", forma: "pix" as const };

beforeEach(() => {
  perfilAtual = "dona";
  falso = criarSupabaseFalso();
  exigirPerfil.mockClear();
  revalidatePath.mockClear();
});

describe("pagarComissoes", () => {
  it("recepção é negada sem chamar o banco", async () => {
    perfilAtual = "recepcao";
    await expect(pagarComissoes(entrada)).rejects.toThrow("REDIRECT:/inicio");
    expect(exigirPerfil.mock.calls).toEqual([["dona"]]);
    expect(falso.chamadas).toHaveLength(0);
  });

  it("chama pagar_comissoes e revalida o Financeiro", async () => {
    falso.responder("rpc:pagar_comissoes", { data: "conta-1", error: null });
    expect(await pagarComissoes(entrada)).toEqual({ ok: true });
    expect(falso.chamadasRpc("pagar_comissoes")[0].args[0]).toEqual({
      p_profissional: PROF,
      p_competencia: "2026-11-01",
      p_pago_em: "2026-11-10",
      p_forma: "pix",
    });
    expect(revalidatePath).toHaveBeenCalledWith("/financeiro");
  });

  it("total 0 (devolve null) também é sucesso", async () => {
    falso.responder("rpc:pagar_comissoes", { data: null, error: null });
    expect(await pagarComissoes(entrada)).toEqual({ ok: true });
  });

  it("competência inválida é recusada sem chamar o banco", async () => {
    for (const competencia of ["2026-11-15", "2026-13-01", "11/2026", ""]) {
      const r = await pagarComissoes({ ...entrada, competencia });
      expect(r).toEqual({ ok: false, erro: "Competência inválida." });
    }
    expect(falso.chamadas).toHaveLength(0);
  });

  it("forma a_receber e data inválida são recusadas", async () => {
    expect((await pagarComissoes({ ...entrada, forma: "a_receber" as never })).ok).toBe(false);
    expect((await pagarComissoes({ ...entrada, pagoEm: "2026-02-30" })).ok).toBe(false);
    expect((await pagarComissoes({ ...entrada, profissionalId: "x" })).ok).toBe(false);
    expect(falso.chamadas).toHaveLength(0);
  });

  it('repassa "Não há comissões em aberto."', async () => {
    falso.responder("rpc:pagar_comissoes", {
      data: null,
      error: { code: "P0001", message: "Não há comissões em aberto." },
    });
    expect(await pagarComissoes(entrada)).toEqual({ ok: false, erro: "Não há comissões em aberto." });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
