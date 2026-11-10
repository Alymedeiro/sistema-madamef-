import { beforeEach, describe, expect, it, vi } from "vitest";
import { criarSupabaseFalso } from "@/test/supabase-falso";

const falso = vi.hoisted(() => ({ atual: null as unknown }));
const exigirPerfil = vi.hoisted(() => vi.fn());
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/sessao", () => ({ exigirPerfil }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => falso.atual }));

import { marcarAvisosLidos } from "./actions";

describe("marcarAvisosLidos", () => {
  beforeEach(() => {
    exigirPerfil.mockReset();
    exigirPerfil.mockResolvedValue({});
  });

  it("exige a dona e chama a função com as chaves", async () => {
    const s = criarSupabaseFalso();
    s.responder("rpc:marcar_avisos_lidos", { data: null, error: null });
    falso.atual = s.cliente;
    expect(await marcarAvisosLidos(["pagar:p1:3"])).toEqual({ ok: true });
    expect(exigirPerfil).toHaveBeenCalledWith("dona");
    expect(s.chamadasRpc("marcar_avisos_lidos")[0].args[0]).toEqual({ p_chaves: ["pagar:p1:3"] });
  });

  it("recusa lista vazia sem chamar o banco", async () => {
    const s = criarSupabaseFalso();
    falso.atual = s.cliente;
    expect((await marcarAvisosLidos([])).ok).toBe(false);
    expect(s.chamadas).toEqual([]);
  });

  it("erro do banco vira mensagem", async () => {
    const s = criarSupabaseFalso();
    s.responder("rpc:marcar_avisos_lidos", { data: null, error: { message: "x" } });
    falso.atual = s.cliente;
    expect((await marcarAvisosLidos(["a"])).ok).toBe(false);
  });
});
