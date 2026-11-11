import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Perfil } from "@/lib/dominio/permissoes";
import { criarSupabaseFalso } from "@/test/supabase-falso";

let perfilAtual: Perfil | null = "dona";
const EU = "c0000000-0000-4000-8000-00000000000c";
// Reproduz o contrato de exigirPerfil: sem login → /login; perfil errado → /inicio.
const exigirPerfil = vi.fn(async (...perfis: Perfil[]) => {
  if (!perfilAtual) throw new Error("REDIRECT:/login");
  if (perfis.length > 0 && !perfis.includes(perfilAtual)) throw new Error("REDIRECT:/inicio");
  return { userId: "u1", colaborador: { id: EU, nome: "Teste", perfil: perfilAtual } };
});
vi.mock("@/lib/sessao", () => ({ exigirPerfil: (...p: Perfil[]) => exigirPerfil(...p) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/site", () => ({ urlDoSite: async () => "http://localhost:3000" }));

let falso = criarSupabaseFalso();
const createClient = vi.fn(async () => falso.cliente);
vi.mock("@/lib/supabase/server", () => ({ createClient: () => createClient() }));

const AUTH_ID = "a0000000-0000-4000-8000-0000000000aa";
const inviteUserByEmail = vi.fn(async () => ({ data: { user: { id: AUTH_ID } }, error: null }));
const deleteUser = vi.fn(async () => ({ data: null, error: null }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    auth: {
      admin: {
        inviteUserByEmail: (...a: unknown[]) => inviteUserByEmail(...(a as [])),
        deleteUser: (...a: unknown[]) => deleteUser(...(a as [])),
      },
    },
  }),
}));

import { atualizarColaborador, convidarColaborador } from "./actions";

const ID = "b2222222-2222-4222-8222-222222222222";
const novo = {
  nome: "Ana Souza",
  email: "ana@madamefe.com.br",
  funcao: "Esteticista",
  perfil: "profissional" as const,
  cor: "#986818",
  telefone: "",
};
const { email: _email, ...edicao } = novo;
void _email;

beforeEach(() => {
  perfilAtual = "dona";
  falso = criarSupabaseFalso();
  exigirPerfil.mockClear();
  createClient.mockClear();
  inviteUserByEmail.mockClear();
  deleteUser.mockClear();
});

describe("guarda de perfil na comissão da equipe", () => {
  for (const perfil of ["recepcao", "profissional"] as const) {
    it(`${perfil} não grava % (convidar e atualizar são barradas)`, async () => {
      perfilAtual = perfil;
      await expect(convidarColaborador({ ...novo, comissaoPadraoPct: "30" })).rejects.toThrow(
        "REDIRECT:/inicio",
      );
      await expect(
        atualizarColaborador(ID, { ...edicao, comissaoPadraoPct: "30" }),
      ).rejects.toThrow("REDIRECT:/inicio");
      expect(exigirPerfil).toHaveBeenCalledWith("dona");
      expect(createClient).not.toHaveBeenCalled();
      expect(falso.chamadasDe("colaboradores_comissao")).toHaveLength(0);
    });
  }
});

describe("comissão padrão", () => {
  it("convite grava a comissão pelo id do colaborador criado", async () => {
    falso.responder("colaboradores", { data: { id: ID }, error: null });
    expect(await convidarColaborador({ ...novo, comissaoPadraoPct: "12,5" })).toEqual({ ok: true });
    const up = falso.chamadasDe("colaboradores_comissao", "upsert");
    expect(up[0].args[0]).toEqual({ colaborador_id: ID, percentual: 12.5 });
    expect(up[0].args[1]).toEqual({ onConflict: "colaborador_id" });
  });

  it("vazio grava 0", async () => {
    falso.responder("colaboradores", { data: { id: ID }, error: null });
    expect(await convidarColaborador({ ...novo, comissaoPadraoPct: "" })).toEqual({ ok: true });
    expect(falso.chamadasDe("colaboradores_comissao", "upsert")[0].args[0]).toEqual({
      colaborador_id: ID,
      percentual: 0,
    });
  });

  it("edição não envia a comissão na tabela colaboradores e grava em colaboradores_comissao", async () => {
    expect(await atualizarColaborador(ID, { ...edicao, comissaoPadraoPct: "30" })).toEqual({
      ok: true,
    });
    const linha = falso.chamadasDe("colaboradores", "update")[0].args[0] as Record<string, unknown>;
    expect("comissaoPadraoPct" in linha).toBe(false);
    expect(falso.chamadasDe("colaboradores_comissao", "upsert")[0].args[0]).toEqual({
      colaborador_id: ID,
      percentual: 30,
    });
  });

  it("sem o campo não mexe na comissão", async () => {
    expect(await atualizarColaborador(ID, edicao)).toEqual({ ok: true });
    expect(falso.chamadasDe("colaboradores_comissao")).toHaveLength(0);
  });

  it("recusa 101 sem convidar nem tocar no banco", async () => {
    expect(await convidarColaborador({ ...novo, comissaoPadraoPct: "101" })).toEqual({
      ok: false,
      erro: "A comissão deve estar entre 0 e 100%.",
    });
    expect(inviteUserByEmail).not.toHaveBeenCalled();
    expect(falso.chamadas).toHaveLength(0);
  });

  it("avisa quando os dados foram salvos mas a comissão não", async () => {
    falso.responder("colaboradores_comissao", {
      data: null,
      error: { code: "42501", message: "x" },
    });
    expect(await atualizarColaborador(ID, { ...edicao, comissaoPadraoPct: "10" })).toEqual({
      ok: false,
      erro: "Os dados foram salvos, mas não foi possível salvar a comissão. Você não tem permissão para esta ação.",
    });
  });
});
