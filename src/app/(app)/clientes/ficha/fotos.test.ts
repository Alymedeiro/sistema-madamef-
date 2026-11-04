import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Perfil } from "@/lib/dominio/permissoes";
import { criarSupabaseFalso } from "@/test/supabase-falso";

let perfilAtual: Perfil | null = "profissional";
const exigirPerfil = vi.fn(async (...perfis: Perfil[]) => {
  if (!perfilAtual) throw new Error("REDIRECT:/login");
  if (perfis.length > 0 && !perfis.includes(perfilAtual)) throw new Error("REDIRECT:/inicio");
  return { userId: "u1", colaborador: { id: "c1", nome: "Teste", perfil: perfilAtual } };
});
vi.mock("@/lib/sessao", () => ({ exigirPerfil: (...p: Perfil[]) => exigirPerfil(...p) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("server-only", () => ({}));

let falso = criarSupabaseFalso();
let admin = criarSupabaseFalso();
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => falso.cliente }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => admin.cliente }));

import { arquivarFoto, registrarFotos, urlsFotos } from "./fotos";
import { carregarFotos } from "./dados";
import type { Supabase } from "@/lib/ficha/acesso";

const C = "5b0c1d52-3c4e-4f6a-8b7d-1a2b3c4d5e6f";
const OUTRA = "6c1d2e63-4d5f-4a7b-9c8e-2b3c4d5e6f70";
const U = "7d2e3f74-5e60-4b8c-8d9f-3c4d5e6f7081";
const U2 = "8e3f4085-6f71-4c9d-9eaf-4d5e6f708192";
const S = "9f4a5b96-7a82-4dae-8fb0-5e6f70819203";
const F1 = "a05b6ca7-8b93-4ebf-80c1-6f7081920314";
const F2 = "b16c7db8-9ca4-4fc0-91d2-708192031425";
const P1 = `clientes/${C}/fotos/${U}.jpg`;
const P2 = `clientes/${C}/fotos/${U2}.jpg`;

beforeEach(() => {
  perfilAtual = "profissional";
  falso = criarSupabaseFalso();
  admin = criarSupabaseFalso();
  exigirPerfil.mockClear();
});

describe("registrarFotos", () => {
  it("recusa caminho de outra cliente, área errada, extensão errada e não grava nada", async () => {
    for (const path of [
      `clientes/${OUTRA}/fotos/${U}.jpg`,
      `clientes/${C}/termos/${U}.jpg`,
      `clientes/${C}/fotos/${U}.png`,
      `clientes/${C}/fotos/../${U}.jpg`,
    ]) {
      expect(await registrarFotos(C, [{ path, tipo: "antes" }])).toEqual({
        ok: false,
        erro: "Foto inválida.",
      });
    }
    // Um item bom não salva o lote se outro for ruim.
    expect(
      await registrarFotos(C, [
        { path: P1, tipo: "antes" },
        { path: `clientes/${OUTRA}/fotos/${U2}.jpg`, tipo: "depois" },
      ]),
    ).toEqual({ ok: false, erro: "Foto inválida." });
    expect(falso.chamadasDe("fotos", "insert")).toHaveLength(0);
  });

  it("insere em lote com os campos esperados", async () => {
    falso.responder("fotos", { data: null, error: null });
    const r = await registrarFotos(C, [
      { path: P1, tipo: "antes", servicoId: S },
      { path: P2, tipo: "depois" },
    ]);
    expect(r).toEqual({ ok: true });
    const inseridos = falso.chamadasDe("fotos", "insert")[0].args[0] as Record<string, unknown>[];
    expect(inseridos[0]).toMatchObject({ cliente_id: C, path: P1, tipo: "antes", servico_id: S });
    expect(inseridos[1]).toMatchObject({ cliente_id: C, path: P2, tipo: "depois" });
  });

  it("falha do banco remove só os órfãos (não registrados) pelo admin", async () => {
    falso.responder("fotos", { data: null, error: { code: "42501", message: "rls" } });
    admin.responder("fotos", { data: [{ path: P2 }], error: null });
    const r = await registrarFotos(C, [
      { path: P1, tipo: "antes" },
      { path: P2, tipo: "depois" },
    ]);
    expect(r).toEqual({ ok: false, erro: "Você não tem permissão para esta ação." });
    expect(admin.chamadasDe("storage:ficha-clinica", "remove")[0].args[0]).toEqual([P1]);
  });

  it("caminho já registrado (23505) nunca apaga arquivo", async () => {
    falso.responder("fotos", { data: null, error: { code: "23505", message: "fotos_path_key" } });
    const r = await registrarFotos(C, [{ path: P1, tipo: "antes" }]);
    expect(r.ok).toBe(false);
    expect(admin.chamadasDe("storage:ficha-clinica", "remove")).toHaveLength(0);
  });

  it("ignora tiradaEm enviado: o banco usa now()", async () => {
    falso.responder("fotos", { data: null, error: null });
    await registrarFotos(C, [
      { path: P1, tipo: "antes", tiradaEm: "1900-01-01T00:00:00Z" } as never,
    ]);
    const ins = falso.chamadasDe("fotos", "insert")[0].args[0] as Record<string, unknown>[];
    expect(ins[0]).not.toHaveProperty("tirada_em");
  });

  it("recepção é barrada; 0 e 21 itens são recusados sem gravar", async () => {
    perfilAtual = "recepcao";
    await expect(registrarFotos(C, [{ path: P1, tipo: "antes" }])).rejects.toThrow("REDIRECT:/inicio");
    perfilAtual = "dona";
    const muitos = Array.from({ length: 21 }, () => ({ path: P1, tipo: "antes" as const }));
    expect((await registrarFotos(C, muitos)).ok).toBe(false);
    expect((await registrarFotos(C, [])).ok).toBe(false);
    expect(falso.chamadasDe("fotos", "insert")).toHaveLength(0);
  });
});

describe("urlsFotos", () => {
  it("audita cada foto antes de assinar com 300 s", async () => {
    perfilAtual = "dona";
    falso.responder("fotos", {
      data: [
        { id: F1, cliente_id: C, path: P1 },
        { id: F2, cliente_id: C, path: P2 },
      ],
      error: null,
    });
    const r = await urlsFotos([F1, F2]);
    expect(r).toEqual({
      ok: true,
      urls: { [F1]: `https://assinada/${P1}`, [F2]: `https://assinada/${P2}` },
    });
    const rpcs = falso.chamadasRpc("registrar_acesso");
    expect(rpcs.map((c) => (c.args[0] as { p_entidade_id: string }).p_entidade_id)).toEqual([F1, F2]);
    const ordem = falso.chamadas.map((c) => c.metodo);
    expect(ordem.lastIndexOf("rpc")).toBeLessThan(ordem.indexOf("createSignedUrls"));
    expect(falso.chamadasDe("storage:ficha-clinica", "createSignedUrls")[0].args).toEqual([[P1, P2], 300]);
  });

  it("falha na auditoria não entrega URL; recepção é barrada; ids inválidos recusados", async () => {
    falso.responder("fotos", { data: [{ id: F1, cliente_id: C, path: P1 }], error: null });
    falso.responder("rpc:registrar_acesso", { data: null, error: { message: "x" } });
    expect((await urlsFotos([F1])).ok).toBe(false);
    expect(falso.chamadasDe("storage:ficha-clinica", "createSignedUrls")).toHaveLength(0);
    expect((await urlsFotos(["nao-uuid"])).ok).toBe(false);
    expect((await urlsFotos([])).ok).toBe(false);
    perfilAtual = "recepcao";
    await expect(urlsFotos([F1])).rejects.toThrow("REDIRECT:/inicio");
  });
});

describe("arquivarFoto", () => {
  it("só a dona arquiva", async () => {
    await expect(arquivarFoto(F1)).rejects.toThrow("REDIRECT:/inicio");
    perfilAtual = "dona";
    falso.responder("fotos", { data: [{ id: F1 }], error: null });
    expect(await arquivarFoto(F1)).toEqual({ ok: true });
    expect(falso.chamadasDe("fotos", "update")[0].args[0]).toEqual({ arquivada: true });
  });
  it("0 linhas vira 'Foto não encontrada.'", async () => {
    perfilAtual = "dona";
    falso.responder("fotos", { data: [], error: null });
    expect(await arquivarFoto(F1)).toEqual({ ok: false, erro: "Foto não encontrada." });
  });
});

describe("carregarFotos", () => {
  it("audita antes do select e devolve URLs de 300 s", async () => {
    falso.responder("fotos", {
      data: [
        {
          id: F1,
          tipo: "antes",
          tirada_em: "2026-11-04T15:00:00Z",
          path: P1,
          servicos: { nome: "Peeling" },
        },
      ],
      error: null,
    });
    const r = await carregarFotos(falso.cliente as unknown as Supabase, C);
    expect(r).toEqual([
      { id: F1, tipo: "antes", tiradaEm: "2026-11-04T15:00:00Z", servicoNome: "Peeling", url: `https://assinada/${P1}` },
    ]);
    const ordem = falso.chamadas.map((c) => c.metodo);
    expect(ordem.indexOf("rpc")).toBeLessThan(ordem.indexOf("select"));
    expect(falso.chamadasDe("fotos", "eq").some((c) => c.args[0] === "arquivada")).toBe(true);
    expect(falso.chamadasDe("storage:ficha-clinica", "createSignedUrls")[0].args[1]).toBe(300);
  });
});
