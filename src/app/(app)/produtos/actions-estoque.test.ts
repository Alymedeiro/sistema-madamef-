import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Perfil } from "@/lib/dominio/permissoes";
import { criarSupabaseFalso } from "@/test/supabase-falso";

let perfilAtual: Perfil = "dona";
const exigirPerfil = vi.fn(async (...perfis: Perfil[]) => {
  if (perfis.length > 0 && !perfis.includes(perfilAtual)) throw new Error("REDIRECT:/inicio");
  return { userId: "u1", colaborador: { id: "c1", nome: "Fê", perfil: perfilAtual } };
});
vi.mock("@/lib/sessao", () => ({ exigirPerfil: (...p: Perfil[]) => exigirPerfil(...p) }));
const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => revalidatePath(...a) }));

let falso = criarSupabaseFalso();
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => falso.cliente }));

import { ajustarEstoque, registrarEntrada } from "./actions-estoque";

const PRODUTO = "a0000000-0000-4000-8000-0000000000a1";
const entrada = { produtoId: PRODUTO, quantidade: "1,5", custo: "12,50", lancarDespesa: false };
const ajuste = { produtoId: PRODUTO, contada: "3", motivo: "Contagem do mês" };

beforeEach(() => {
  perfilAtual = "dona";
  falso = criarSupabaseFalso();
  exigirPerfil.mockClear();
  revalidatePath.mockClear();
});

describe("registrarEntrada", () => {
  it("recepção é negada sem chamar o banco", async () => {
    perfilAtual = "recepcao";
    await expect(registrarEntrada(entrada)).rejects.toThrow("REDIRECT:/inicio");
    expect(exigirPerfil.mock.calls).toEqual([["dona"]]);
    expect(falso.chamadas).toHaveLength(0);
  });

  it('"1,5" vira 1.5 e "12,50" vira 1250 centavos; sem despesa vai sem vencimento', async () => {
    falso.responder("rpc:entrada_estoque", { data: "m1", error: null });
    expect(await registrarEntrada({ ...entrada, vencimento: "2026-11-20", fornecedor: "X" })).toEqual({
      ok: true,
    });
    expect(falso.chamadasRpc("entrada_estoque")[0].args[0]).toEqual({
      p_produto: PRODUTO,
      p_quantidade: 1.5,
      p_custo_unitario_centavos: 1250,
      p_lancar_despesa: false,
      p_vencimento: null,
      p_fornecedor: null,
    });
    expect(revalidatePath).toHaveBeenCalledWith("/produtos", "layout");
    expect(revalidatePath).toHaveBeenCalledWith("/inicio");
  });

  it("com despesa manda vencimento e fornecedor aparado", async () => {
    falso.responder("rpc:entrada_estoque", { data: "m1", error: null });
    const r = await registrarEntrada({
      ...entrada,
      quantidade: "2",
      lancarDespesa: true,
      vencimento: "2026-11-20",
      fornecedor: "  Distribuidora  ",
    });
    expect(r).toEqual({ ok: true });
    expect(falso.chamadasRpc("entrada_estoque")[0].args[0]).toMatchObject({
      p_quantidade: 2,
      p_lancar_despesa: true,
      p_vencimento: "2026-11-20",
      p_fornecedor: "Distribuidora",
    });
  });

  it('"0" é recusado antes do banco', async () => {
    for (const quantidade of ["0", "0,000"]) {
      expect(await registrarEntrada({ ...entrada, quantidade })).toEqual({
        ok: false,
        erro: "A quantidade deve ser maior que zero.",
      });
    }
    expect(falso.chamadas).toHaveLength(0);
  });

  it("quantidade e custo inválidos são recusados antes do banco", async () => {
    for (const quantidade of ["", "abc", "-1", "1,2345"]) {
      expect((await registrarEntrada({ ...entrada, quantidade })).ok).toBe(false);
    }
    for (const custo of ["", "abc", "-1", "1.5"]) {
      expect((await registrarEntrada({ ...entrada, custo })).ok).toBe(false);
    }
    expect((await registrarEntrada({ ...entrada, produtoId: "x" })).ok).toBe(false);
    expect(falso.chamadas).toHaveLength(0);
  });

  it("vencimento é obrigatório quando lança a despesa", async () => {
    for (const vencimento of [undefined, "", "2026-02-30"]) {
      expect(await registrarEntrada({ ...entrada, lancarDespesa: true, vencimento })).toEqual({
        ok: false,
        erro: "Informe o vencimento.",
      });
    }
    expect(falso.chamadas).toHaveLength(0);
  });

  it("total acima do limite é recusado antes do banco", async () => {
    const r = await registrarEntrada({ ...entrada, quantidade: "999999", custo: "100.000,00" });
    expect(r).toEqual({ ok: false, erro: "O total da compra passou do limite." });
    expect(falso.chamadas).toHaveLength(0);
  });

  it("repassa a mensagem do banco e não revalida", async () => {
    falso.responder("rpc:entrada_estoque", {
      data: null,
      error: { code: "P0001", message: "Apenas a dona pode lançar contas." },
    });
    expect(await registrarEntrada(entrada)).toEqual({ ok: false, erro: "Apenas a dona pode lançar contas." });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("produto inexistente (chave estrangeira) vira Produto não encontrado.", async () => {
    falso.responder("rpc:entrada_estoque", { data: null, error: { code: "23503", message: "fk" } });
    expect(await registrarEntrada(entrada)).toEqual({ ok: false, erro: "Produto não encontrado." });
  });
});

describe("ajustarEstoque", () => {
  it("recepção é negada sem chamar o banco", async () => {
    perfilAtual = "recepcao";
    await expect(ajustarEstoque(ajuste)).rejects.toThrow("REDIRECT:/inicio");
    expect(falso.chamadas).toHaveLength(0);
  });

  it('chama ajustar_estoque com a contada ("0,5" → 0.5) e o motivo aparado', async () => {
    falso.responder("rpc:ajustar_estoque", { data: "m1", error: null });
    expect(await ajustarEstoque({ ...ajuste, contada: "0,5", motivo: "  Quebra  " })).toEqual({ ok: true });
    expect(falso.chamadasRpc("ajustar_estoque")[0].args[0]).toEqual({
      p_produto: PRODUTO,
      p_quantidade_contada: 0.5,
      p_motivo: "Quebra",
    });
    expect(revalidatePath).toHaveBeenCalledWith("/produtos", "layout");
    expect(revalidatePath).toHaveBeenCalledWith("/inicio");
  });

  it("contada 0 é permitida (zerar o estoque)", async () => {
    falso.responder("rpc:ajustar_estoque", { data: "m1", error: null });
    expect(await ajustarEstoque({ ...ajuste, contada: "0" })).toEqual({ ok: true });
  });

  it("negativa, inválida e sem motivo são recusadas antes do banco", async () => {
    expect(await ajustarEstoque({ ...ajuste, contada: "-1" })).toEqual({
      ok: false,
      erro: "A quantidade contada não pode ser negativa.",
    });
    expect((await ajustarEstoque({ ...ajuste, contada: "abc" })).ok).toBe(false);
    expect((await ajustarEstoque({ ...ajuste, contada: "" })).ok).toBe(false);
    expect(await ajustarEstoque({ ...ajuste, motivo: "   " })).toEqual({
      ok: false,
      erro: "Informe o motivo do ajuste.",
    });
    expect((await ajustarEstoque({ ...ajuste, motivo: "x".repeat(201) })).ok).toBe(false);
    expect(falso.chamadas).toHaveLength(0);
  });

  it('repassa "O estoque já está com essa quantidade."', async () => {
    falso.responder("rpc:ajustar_estoque", {
      data: null,
      error: { code: "P0001", message: "O estoque já está com essa quantidade." },
    });
    expect(await ajustarEstoque(ajuste)).toEqual({
      ok: false,
      erro: "O estoque já está com essa quantidade.",
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
