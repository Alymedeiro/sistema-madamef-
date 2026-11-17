import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Perfil } from "@/lib/dominio/permissoes";
import { criarSupabaseFalso } from "@/test/supabase-falso";

let perfilAtual: Perfil | null = "dona";
const exigirPerfil = vi.fn(async (...perfis: Perfil[]) => {
  if (!perfilAtual) throw new Error("REDIRECT:/login");
  if (perfis.length > 0 && !perfis.includes(perfilAtual)) throw new Error("REDIRECT:/inicio");
  return { userId: "u1", colaborador: { id: "c1", nome: "Teste", perfil: perfilAtual } };
});
vi.mock("@/lib/sessao", () => ({ exigirPerfil: (...p: Perfil[]) => exigirPerfil(...p) }));
const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => revalidatePath(...a) }));

let falso = criarSupabaseFalso();
const createClient = vi.fn(async () => falso.cliente);
vi.mock("@/lib/supabase/server", () => ({ createClient: () => createClient() }));

import { registrarFotoServico, removerFotoServico, reordenarFotosServico } from "./fotos";

const SERVICO = "5b0c1d52-3c4e-4f6a-8b7d-1a2b3c4d5e6f";
const FOTO_A = "a1111111-1111-4111-8111-111111111111";
const FOTO_B = "b2222222-2222-4222-8222-222222222222";
const CAMINHO = `servicos/${SERVICO}/${FOTO_A}.webp`;
const foto = { servicoId: SERVICO, caminho: CAMINHO, largura: 1600, altura: 1200 };

beforeEach(() => {
  perfilAtual = "dona";
  falso = criarSupabaseFalso();
  exigirPerfil.mockClear();
  createClient.mockClear();
  revalidatePath.mockClear();
});

const escritas: [string, () => Promise<unknown>][] = [
  ["registrarFotoServico", () => registrarFotoServico(foto)],
  ["reordenarFotosServico", () => reordenarFotosServico(SERVICO, [FOTO_A])],
  ["removerFotoServico", () => removerFotoServico(FOTO_A)],
];

describe("guarda de perfil nas fotos dos serviços", () => {
  for (const perfil of ["recepcao", "profissional"] as const) {
    for (const [nome, chamar] of escritas) {
      it(`${nome} como ${perfil} é barrada e não toca no banco`, async () => {
        perfilAtual = perfil;
        await expect(chamar()).rejects.toThrow("REDIRECT:/inicio");
        expect(exigirPerfil).toHaveBeenCalledWith("dona");
        expect(createClient).not.toHaveBeenCalled();
      });
    }
  }
  it("sem login redireciona para /login", async () => {
    perfilAtual = null;
    await expect(registrarFotoServico(foto)).rejects.toThrow("REDIRECT:/login");
  });
});

describe("registrarFotoServico", () => {
  it("grava a linha (a ordem fica com o banco) e revalida", async () => {
    expect(await registrarFotoServico(foto)).toEqual({ ok: true });
    const [insert] = falso.chamadasDe("servicos_fotos", "insert");
    expect(insert.args[0]).toEqual({
      servico_id: SERVICO,
      caminho: CAMINHO,
      largura: 1600,
      altura: 1200,
    });
    expect(revalidatePath).toHaveBeenCalledWith("/servicos", "layout");
    expect(revalidatePath).toHaveBeenCalledWith("/agendar");
  });

  it.each([
    ["caminho de outro serviço", { caminho: `servicos/${FOTO_B}/${FOTO_A}.webp` }],
    ["extensão errada", { caminho: `servicos/${SERVICO}/${FOTO_A}.png` }],
    ["serviço inválido", { servicoId: "x" }],
    ["largura zero", { largura: 0 }],
    ["altura fracionada", { altura: 1.5 }],
  ])("recusa %s sem tocar no banco", async (_, mudanca) => {
    const r = await registrarFotoServico({ ...foto, ...mudanca });
    expect(r.ok).toBe(false);
    expect(createClient).not.toHaveBeenCalled();
  });

  it("limite de 5 no banco: devolve a mensagem e apaga o arquivo enviado", async () => {
    falso.responder("servicos_fotos", {
      data: null,
      error: { code: "P0001", message: "Cada serviço pode ter no máximo 5 fotos." },
    });
    const r = await registrarFotoServico(foto);
    expect(r).toEqual({ ok: false, erro: "Cada serviço pode ter no máximo 5 fotos." });
    const [remove] = falso.chamadasDe("storage:servicos-fotos", "remove");
    expect(remove.args[0]).toEqual([CAMINHO]);
  });
});

describe("reordenarFotosServico", () => {
  it("chama a função do banco com a nova ordem", async () => {
    falso.responder("rpc:reordenar_fotos_servico", { data: null, error: null });
    expect(await reordenarFotosServico(SERVICO, [FOTO_B, FOTO_A])).toEqual({ ok: true });
    expect(falso.chamadasRpc("reordenar_fotos_servico")[0].args[0]).toEqual({
      p_servico: SERVICO,
      p_ids: [FOTO_B, FOTO_A],
    });
  });

  it.each([
    ["vazia", []],
    ["repetida", [FOTO_A, FOTO_A]],
    ["id inválido", ["x"]],
    ["mais de 5", Array.from({ length: 6 }, (_, i) => `a111111${i}-1111-4111-8111-111111111111`)],
  ])("recusa lista %s", async (_, ids) => {
    expect((await reordenarFotosServico(SERVICO, ids as string[])).ok).toBe(false);
    expect(createClient).not.toHaveBeenCalled();
  });

  it("devolve a mensagem do banco", async () => {
    falso.responder("rpc:reordenar_fotos_servico", {
      data: null,
      error: { code: "P0001", message: "A lista de fotos não confere com as fotos do serviço." },
    });
    expect(await reordenarFotosServico(SERVICO, [FOTO_A])).toEqual({
      ok: false,
      erro: "A lista de fotos não confere com as fotos do serviço.",
    });
  });
});

describe("removerFotoServico", () => {
  it("apaga a linha e depois o arquivo", async () => {
    falso.responder(
      "servicos_fotos",
      { data: { id: FOTO_A, caminho: CAMINHO }, error: null },
      { data: [{ id: FOTO_A }], error: null },
    );
    expect(await removerFotoServico(FOTO_A)).toEqual({ ok: true });
    expect(falso.chamadasDe("servicos_fotos", "delete")).toHaveLength(1);
    const [remove] = falso.chamadasDe("storage:servicos-fotos", "remove");
    expect(remove.args[0]).toEqual([CAMINHO]);
  });

  it("foto inexistente: não apaga arquivo", async () => {
    falso.responder("servicos_fotos", { data: null, error: null });
    expect(await removerFotoServico(FOTO_A)).toEqual({ ok: false, erro: "Foto não encontrada." });
    expect(falso.chamadasDe("storage:servicos-fotos", "remove")).toHaveLength(0);
  });

  it("id inválido é recusado sem tocar no banco", async () => {
    expect((await removerFotoServico("x")).ok).toBe(false);
    expect(createClient).not.toHaveBeenCalled();
  });
});
