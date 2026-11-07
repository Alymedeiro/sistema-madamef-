import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Perfil } from "@/lib/dominio/permissoes";
import { criarSupabaseFalso } from "@/test/supabase-falso";

let perfilAtual: Perfil = "dona";
const exigirPerfil = vi.fn(async (...perfis: Perfil[]) => {
  if (perfis.length > 0 && !perfis.includes(perfilAtual)) throw new Error("REDIRECT:/inicio");
  return { userId: "u1", colaborador: { id: "c1", nome: "Teste", perfil: perfilAtual } };
});
vi.mock("@/lib/sessao", () => ({ exigirPerfil: (...p: Perfil[]) => exigirPerfil(...p) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

let falso = criarSupabaseFalso();
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => falso.cliente }));

import { salvarModeloTermo } from "./actions";

const A = "6c1d2e63-4d5f-4a7b-9c8e-2b3c4d5e6f70";

beforeEach(() => {
  perfilAtual = "dona";
  falso = criarSupabaseFalso();
});

describe("salvarModeloTermo", () => {
  it("só a dona", async () => {
    perfilAtual = "recepcao";
    await expect(salvarModeloTermo({ titulo: "T", texto: "x" })).rejects.toThrow("REDIRECT:/inicio");
    expect(falso.chamadas).toHaveLength(0);
    expect(exigirPerfil).toHaveBeenCalledWith("dona");
  });

  it("título e texto são obrigatórios, sem tocar no banco", async () => {
    expect(await salvarModeloTermo({ titulo: "  ", texto: "x" })).toEqual({
      ok: false,
      erro: "Informe o título do termo.",
    });
    expect(await salvarModeloTermo({ titulo: "T", texto: " \n " })).toEqual({
      ok: false,
      erro: "Informe o texto do termo.",
    });
    expect((await salvarModeloTermo({ titulo: "T", texto: "x".repeat(20_001) })).ok).toBe(false);
    expect((await salvarModeloTermo({ titulo: "T", texto: "x", anteriorId: "abc" })).ok).toBe(false);
    expect(falso.chamadas).toHaveLength(0);
  });

  it("cria termo novo (anterior nulo)", async () => {
    falso.responder("rpc:salvar_modelo_termo", { data: "novo", error: null });
    expect(await salvarModeloTermo({ titulo: " Termo ", texto: " # Riscos " })).toEqual({ ok: true });
    expect(falso.chamadasRpc("salvar_modelo_termo")[0].args[0]).toEqual({
      p_anterior: null,
      p_titulo: "Termo",
      p_texto: "# Riscos",
    });
  });

  it("edição manda a versão anterior", async () => {
    falso.responder("rpc:salvar_modelo_termo", { data: "novo", error: null });
    expect((await salvarModeloTermo({ anteriorId: A, titulo: "T", texto: "x" })).ok).toBe(true);
    expect(falso.chamadasRpc("salvar_modelo_termo")[0].args[0]).toEqual({
      p_anterior: A,
      p_titulo: "T",
      p_texto: "x",
    });
  });

  it("erro do banco vira mensagem", async () => {
    falso.responder("rpc:salvar_modelo_termo", {
      data: null,
      error: { code: "P0001", message: "Este termo foi alterado por outra pessoa. Recarregue a página." },
    });
    const r = await salvarModeloTermo({ anteriorId: A, titulo: "T", texto: "x" });
    expect(r.ok).toBe(false);
  });
});
