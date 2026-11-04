import { beforeEach, describe, expect, it, vi } from "vitest";

const verifyOtp = vi.fn();
const createClient = vi.fn(async () => ({ auth: { verifyOtp } }));
vi.mock("@/lib/supabase/server", () => ({ createClient: () => createClient() }));

const definirCookie = vi.fn();
vi.mock("next/headers", () => ({ cookies: async () => ({ set: definirCookie }) }));

const redirect = vi.fn((destino: string) => {
  throw new Error(`REDIRECT:${destino}`);
});
vi.mock("next/navigation", () => ({ redirect: (d: string) => redirect(d) }));

import { confirmarLink } from "./actions";
import ConfirmarPage from "./page";

function formulario(campos: Record<string, string>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(campos)) f.set(k, v);
  return f;
}

beforeEach(() => {
  verifyOtp.mockReset();
  createClient.mockClear();
  definirCookie.mockClear();
  redirect.mockClear();
});

describe("GET /auth/confirmar (página)", () => {
  it("link válido: só mostra o botão, sem consumir o token (pré-carregamento de antivírus)", async () => {
    const tela = await ConfirmarPage({
      searchParams: Promise.resolve({ token_hash: "abc_123", type: "invite" }),
    });
    expect(tela).toBeTruthy();
    expect(createClient).not.toHaveBeenCalled();
    expect(verifyOtp).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
  });

  it.each([
    [{}],
    [{ token_hash: "abc", type: "signup" }],
    [{ token_hash: "a b", type: "invite" }],
    [{ token_hash: ["a", "b"], type: "recovery" }],
  ])("parâmetros inválidos %j → /login?motivo=link-invalido", async (params) => {
    await expect(
      ConfirmarPage({ searchParams: Promise.resolve(params as Record<string, string>) }),
    ).rejects.toThrow("REDIRECT:/login?motivo=link-invalido");
    expect(verifyOtp).not.toHaveBeenCalled();
  });
});

describe("POST (Server Action confirmarLink)", () => {
  it("verifica o token, abre a janela de atividade e leva a /definir-senha", async () => {
    verifyOtp.mockResolvedValue({ error: null });
    await expect(
      confirmarLink(formulario({ token_hash: "abc_123", type: "recovery" })),
    ).rejects.toThrow("REDIRECT:/definir-senha");
    expect(verifyOtp).toHaveBeenCalledWith({ token_hash: "abc_123", type: "recovery" });
    expect(definirCookie).toHaveBeenCalledTimes(1);
    expect(definirCookie.mock.calls[0][0]).toBe("ultima_atividade");
  });

  it("token expirado ou já usado → link inválido, sem cookie", async () => {
    verifyOtp.mockResolvedValue({ error: { message: "expired" } });
    await expect(
      confirmarLink(formulario({ token_hash: "abc_123", type: "invite" })),
    ).rejects.toThrow("REDIRECT:/login?motivo=link-invalido");
    expect(definirCookie).not.toHaveBeenCalled();
  });

  it("parâmetros inválidos não chegam ao Supabase", async () => {
    await expect(confirmarLink(formulario({ token_hash: "abc", type: "magiclink" }))).rejects.toThrow(
      "REDIRECT:/login?motivo=link-invalido",
    );
    expect(verifyOtp).not.toHaveBeenCalled();
  });

  it("backend indisponível → link inválido", async () => {
    verifyOtp.mockRejectedValue(new Error("rede"));
    await expect(
      confirmarLink(formulario({ token_hash: "abc_123", type: "invite" })),
    ).rejects.toThrow("REDIRECT:/login?motivo=link-invalido");
  });
});
