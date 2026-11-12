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

import { buscarPausaRobo, retomarRobo } from "./actions";
import { contarPedidosAtendimento } from "./dados";

const CLIENTE = "00000000-0000-4000-8000-0000000000c1";
const ZAP = "5511987654321";

beforeEach(() => {
  perfilAtual = "recepcao";
  falso = criarSupabaseFalso();
  falso.definirPadrao({ data: null, error: null });
});

describe("buscarPausaRobo", () => {
  it("profissional é negada sem tocar no banco", async () => {
    perfilAtual = "profissional";
    await expect(buscarPausaRobo({ clienteId: CLIENTE, telefone: ZAP })).rejects.toThrow("REDIRECT");
    expect(falso.chamadas).toHaveLength(0);
  });

  it("cliente: procura pelo cliente_id e devolve a pausa mais longa", async () => {
    falso.responder("robo_sessoes", {
      data: [
        { telefone: "551187654321", pausado_ate: "2026-11-13T10:00:00Z" },
        { telefone: ZAP, pausado_ate: "2026-11-13T12:00:00Z" },
      ],
      error: null,
    });
    expect(await buscarPausaRobo({ clienteId: CLIENTE, telefone: ZAP })).toEqual({
      ok: true,
      pausa: { telefone: ZAP, pausadoAte: "2026-11-13T12:00:00Z" },
    });
    expect(falso.chamadasDe("robo_sessoes", "eq")[0].args).toEqual(["cliente_id", CLIENTE]);
    expect(falso.chamadasDe("robo_sessoes", "gt")[0].args[0]).toBe("pausado_ate");
  });

  it("sem cadastro: procura pelo telefone; nada pausado → null", async () => {
    falso.responder("robo_sessoes", { data: [], error: null });
    expect(await buscarPausaRobo({ clienteId: null, telefone: ZAP })).toEqual({ ok: true, pausa: null });
    expect(falso.chamadasDe("robo_sessoes", "eq")[0].args).toEqual(["telefone", ZAP]);
  });

  it("entrada inválida é recusada antes do banco", async () => {
    expect((await buscarPausaRobo({ clienteId: "x", telefone: ZAP })).ok).toBe(false);
    expect((await buscarPausaRobo({ clienteId: null, telefone: "abc" })).ok).toBe(false);
    expect(falso.chamadas).toHaveLength(0);
  });
});

describe("retomarRobo", () => {
  it("profissional é negada", async () => {
    perfilAtual = "profissional";
    await expect(retomarRobo(ZAP)).rejects.toThrow("REDIRECT");
    expect(falso.chamadas).toHaveLength(0);
  });

  it("telefone inválido não chama o banco", async () => {
    expect(await retomarRobo("123")).toEqual({ ok: false, erro: "Telefone inválido." });
    expect(falso.chamadas).toHaveLength(0);
  });

  it("chama retomar_robo; erro P0001 vira a mensagem", async () => {
    expect(await retomarRobo(ZAP)).toEqual({ ok: true });
    expect(falso.chamadasRpc("retomar_robo")[0].args[0]).toEqual({ p_telefone: ZAP });
    falso.responder("rpc:retomar_robo", { data: null, error: { code: "P0001", message: "Não." } });
    expect(await retomarRobo(ZAP)).toEqual({ ok: false, erro: "Não." });
  });
});

describe("contarPedidosAtendimento", () => {
  it("devolve o número da RPC e lança no erro", async () => {
    falso.responder("rpc:robo_pedidos_atendimento", { data: 3, error: null });
    expect(await contarPedidosAtendimento(falso.cliente as never)).toBe(3);
    falso.responder("rpc:robo_pedidos_atendimento", { data: null, error: { message: "x" } });
    await expect(contarPedidosAtendimento(falso.cliente as never)).rejects.toThrow();
  });
});
