import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
// Fora do React, `cache` não memoiza; aqui só precisa devolver a função.
vi.mock("react", () => ({ cache: <T>(fn: T) => fn }));
vi.mock("next/navigation", () => ({
  redirect: (destino: string) => {
    throw new Error(`REDIRECT:${destino}`);
  },
}));

const getClaims = vi.fn();
const maybeSingle = vi.fn();
const eq = vi.fn();
const consulta = { select: vi.fn(), eq, maybeSingle };
consulta.select.mockReturnValue(consulta);
eq.mockReturnValue(consulta);

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getClaims },
    from: () => consulta,
  }),
}));

import { exigirPerfil, getSessao } from "./sessao";

const colaborador = { id: "c1", nome: "Fernanda", perfil: "recepcao" as const };

beforeEach(() => {
  getClaims.mockReset();
  maybeSingle.mockReset();
});

describe("getSessao", () => {
  it("devolve a sessão do colaborador ativo", async () => {
    getClaims.mockResolvedValue({ data: { claims: { sub: "u1" } }, error: null });
    maybeSingle.mockResolvedValue({ data: colaborador, error: null });
    expect(await getSessao()).toEqual({ userId: "u1", colaborador });
    expect(eq).toHaveBeenCalledWith("usuario_auth_id", "u1");
  });

  it("devolve null sem usuário", async () => {
    getClaims.mockResolvedValue({ data: null, error: { message: "x" } });
    expect(await getSessao()).toBeNull();
  });

  it("devolve null quando o Supabase está inalcançável", async () => {
    getClaims.mockRejectedValue(new TypeError("fetch failed"));
    expect(await getSessao()).toBeNull();
  });

  it("devolve null para colaborador inativo (0 linhas pelo RLS)", async () => {
    getClaims.mockResolvedValue({ data: { claims: { sub: "u1" } }, error: null });
    maybeSingle.mockResolvedValue({ data: null, error: null });
    expect(await getSessao()).toBeNull();
  });

  it("falha de consulta é lançada, não confundida com inativo", async () => {
    getClaims.mockResolvedValue({ data: { claims: { sub: "u1" } }, error: null });
    maybeSingle.mockResolvedValue({ data: null, error: { message: "boom" } });
    await expect(getSessao()).rejects.toThrow("boom");
  });
});

describe("exigirPerfil", () => {
  it("sem sessão redireciona para /login", async () => {
    getClaims.mockResolvedValue({ data: null, error: null });
    await expect(exigirPerfil()).rejects.toThrow("REDIRECT:/login");
  });

  it("colaborador inativo vai para /login?motivo=inativo", async () => {
    getClaims.mockResolvedValue({ data: { claims: { sub: "u1" } }, error: null });
    maybeSingle.mockResolvedValue({ data: null, error: null });
    await expect(exigirPerfil()).rejects.toThrow(
      "REDIRECT:/login?motivo=inativo",
    );
  });

  it("perfil sem permissão vai para /inicio", async () => {
    getClaims.mockResolvedValue({ data: { claims: { sub: "u1" } }, error: null });
    maybeSingle.mockResolvedValue({ data: colaborador, error: null });
    await expect(exigirPerfil("dona")).rejects.toThrow("REDIRECT:/inicio");
  });

  it("perfil permitido devolve a sessão", async () => {
    getClaims.mockResolvedValue({ data: { claims: { sub: "u1" } }, error: null });
    maybeSingle.mockResolvedValue({ data: colaborador, error: null });
    const s = await exigirPerfil("dona", "recepcao");
    expect(s.colaborador.perfil).toBe("recepcao");
  });

  it("sem lista de perfis, qualquer colaborador ativo passa", async () => {
    getClaims.mockResolvedValue({ data: { claims: { sub: "u1" } }, error: null });
    maybeSingle.mockResolvedValue({ data: colaborador, error: null });
    await expect(exigirPerfil()).resolves.toMatchObject({ userId: "u1" });
  });
});
