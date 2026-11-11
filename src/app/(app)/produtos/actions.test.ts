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
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

let falso = criarSupabaseFalso();
const createClient = vi.fn(async () => falso.cliente);
vi.mock("@/lib/supabase/server", () => ({ createClient: () => createClient() }));

import { definirProdutoAtivo, salvarProduto } from "./actions";

const ID = "5b0c1d52-3c4e-4f6a-8b7d-1a2b3c4d5e6f";
const produto = {
  nome: "Ácido hialurônico",
  unidade: "ml",
  precoVendaCentavos: null,
  custoCentavos: 12000,
  estoqueMinimo: 2,
};

beforeEach(() => {
  perfilAtual = "dona";
  falso = criarSupabaseFalso();
  exigirPerfil.mockClear();
  createClient.mockClear();
});

describe("guarda de perfil nas escritas de produtos", () => {
  for (const perfil of ["recepcao", "profissional"] as const) {
    it(`salvarProduto e definirProdutoAtivo como ${perfil} são barradas sem tocar no banco`, async () => {
      perfilAtual = perfil;
      await expect(salvarProduto(produto)).rejects.toThrow("REDIRECT:/inicio");
      await expect(definirProdutoAtivo(ID, false)).rejects.toThrow("REDIRECT:/inicio");
      expect(exigirPerfil).toHaveBeenCalledWith("dona");
      expect(createClient).not.toHaveBeenCalled();
      expect(falso.chamadas).toHaveLength(0);
    });
  }
});

describe("salvarProduto", () => {
  it("cria o produto sem custo na tabela pública e grava o custo em produtos_custos", async () => {
    falso.responder("produtos", { data: { id: ID }, error: null });
    const r = await salvarProduto(produto);
    expect(r).toEqual({ ok: true });

    const linha = falso.chamadasDe("produtos", "insert")[0].args[0] as Record<string, unknown>;
    expect(linha).toEqual({
      nome: "Ácido hialurônico",
      unidade: "ml",
      preco_venda_centavos: null,
      estoque_minimo: 2,
    });
    expect("estoque_atual" in linha).toBe(false);
    expect(falso.chamadasRpc("ajustar_estoque")).toHaveLength(0);
    expect("custo_unitario_centavos" in linha).toBe(false);

    const custo = falso.chamadasDe("produtos_custos", "upsert")[0];
    expect(custo.args[0]).toEqual({ produto_id: ID, custo_unitario_centavos: 12000 });
    expect(custo.args[1]).toEqual({ onConflict: "produto_id" });
  });

  it("produto novo com estoque inicial: insere com 0 e lança ajuste 'Estoque inicial'", async () => {
    falso.responder("produtos", { data: { id: ID }, error: null });
    falso.responder("rpc:ajustar_estoque", { data: "mov-1", error: null });
    const r = await salvarProduto({ ...produto, estoqueInicial: 4 });
    expect(r).toEqual({ ok: true });

    const linha = falso.chamadasDe("produtos", "insert")[0].args[0] as Record<string, unknown>;
    expect("estoque_atual" in linha).toBe(false);
    const rpc = falso.chamadasRpc("ajustar_estoque");
    expect(rpc).toHaveLength(1);
    expect(rpc[0].args[0]).toEqual({
      p_produto: ID,
      p_quantidade_contada: 4,
      p_motivo: "Estoque inicial",
    });
  });

  it("avisa quando o produto foi salvo mas o estoque inicial não", async () => {
    falso.responder("produtos", { data: { id: ID }, error: null });
    falso.responder("rpc:ajustar_estoque", {
      data: null,
      error: { code: "P0001", message: "Apenas a dona pode lançar contas." },
    });
    expect(await salvarProduto({ ...produto, estoqueInicial: 4 })).toEqual({
      ok: false,
      erro: "O produto foi salvo, mas não foi possível lançar o estoque inicial. Apenas a dona pode lançar contas.",
    });
  });

  it("recusa estoque inicial negativo sem tocar no banco", async () => {
    expect((await salvarProduto({ ...produto, estoqueInicial: -1 })).ok).toBe(false);
    expect(falso.chamadas).toHaveLength(0);
  });

  it("edita por id e regrava o custo, sem enviar estoque nem ajustar", async () => {
    const r = await salvarProduto({ ...produto, custoCentavos: 9900, estoqueInicial: 7 }, ID);
    expect(r).toEqual({ ok: true });
    expect(falso.chamadasDe("produtos", "update")).toHaveLength(1);
    const linha = falso.chamadasDe("produtos", "update")[0].args[0] as Record<string, unknown>;
    expect("estoque_atual" in linha).toBe(false);
    expect(falso.chamadasRpc("ajustar_estoque")).toHaveLength(0);
    expect(falso.chamadasDe("produtos_custos", "upsert")[0].args[0]).toEqual({
      produto_id: ID,
      custo_unitario_centavos: 9900,
    });
  });

  it("avisa se o produto não existe e não grava custo", async () => {
    falso.responder("produtos", { data: [], error: null });
    expect(await salvarProduto(produto, ID)).toEqual({ ok: false, erro: "Produto não encontrado." });
    expect(falso.chamadasDe("produtos_custos")).toHaveLength(0);
  });

  it("informa quando o produto foi salvo mas o custo não", async () => {
    falso.responder("produtos", { data: { id: ID }, error: null });
    falso.responder("produtos_custos", { data: null, error: { code: "42501", message: "x" } });
    const r = await salvarProduto(produto);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erro).toMatch(/custo/i);
  });

  it("valida os dados sem tocar no banco", async () => {
    expect((await salvarProduto({ ...produto, estoqueMinimo: -1 })).ok).toBe(false);
    expect((await salvarProduto(produto, "x")).ok).toBe(false);
    expect(falso.chamadas).toHaveLength(0);
  });
});

describe("definirProdutoAtivo", () => {
  it("grava ativo e rejeita id inválido", async () => {
    expect(await definirProdutoAtivo(ID, false)).toEqual({ ok: true });
    expect(falso.chamadasDe("produtos", "update")[0].args[0]).toEqual({ ativo: false });
    expect((await definirProdutoAtivo("x", true)).ok).toBe(false);
  });
});
