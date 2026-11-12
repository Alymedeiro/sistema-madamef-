import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Perfil } from "@/lib/dominio/permissoes";
import { criarSupabaseFalso } from "@/test/supabase-falso";

let perfilAtual: Perfil = "recepcao";
const exigirPerfil = vi.fn(async (...perfis: Perfil[]) => {
  if (perfis.length > 0 && !perfis.includes(perfilAtual)) throw new Error("REDIRECT:/inicio");
  return { userId: "u1", colaborador: { id: "c1", nome: "Teste", perfil: perfilAtual } };
});
vi.mock("@/lib/sessao", () => ({ exigirPerfil: (...p: Perfil[]) => exigirPerfil(...p) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("server-only", () => ({}));

let falso = criarSupabaseFalso();
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => falso.cliente }));

import { buscarConversa } from "./actions";

const CLIENTE = "00000000-0000-4000-8000-0000000000c1";

beforeEach(() => {
  perfilAtual = "recepcao";
  falso = criarSupabaseFalso();
  falso.definirPadrao({ data: null, error: null });
});

describe("buscarConversa", () => {
  it("profissional é negada, sem tocar no banco", async () => {
    perfilAtual = "profissional";
    await expect(buscarConversa(CLIENTE)).rejects.toThrow("REDIRECT");
    expect(falso.chamadas).toHaveLength(0);
    expect(exigirPerfil).toHaveBeenCalledWith("dona", "recepcao");
  });

  it("uuid inválido é recusado antes do banco", async () => {
    expect((await buscarConversa("x")).ok).toBe(false);
    expect(falso.chamadas).toHaveLength(0);
  });

  it("devolve os itens da conversa", async () => {
    falso.responder("mensagens_recebidas", {
      data: [{ id: "r1", texto: "Oi", recebida_em: "2026-11-10T12:00:00Z" }],
      error: null,
    });
    falso.responder("fila_mensagens", { data: [], error: null });
    expect(await buscarConversa(CLIENTE)).toEqual({
      ok: true,
      itens: [{ id: "r1", direcao: "recebida", texto: "Oi", quando: "2026-11-10T12:00:00Z" }],
    });
  });

  it("erro do banco vira falha", async () => {
    falso.responder("mensagens_recebidas", { data: null, error: { message: "boom" } });
    falso.responder("fila_mensagens", { data: [], error: null });
    expect((await buscarConversa(CLIENTE)).ok).toBe(false);
  });
});
