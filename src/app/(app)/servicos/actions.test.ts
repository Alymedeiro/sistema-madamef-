import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Perfil } from "@/lib/dominio/permissoes";
import { criarSupabaseFalso } from "@/test/supabase-falso";

let perfilAtual: Perfil | null = "dona";
// Reproduz o contrato de exigirPerfil: sem login → /login; perfil errado → /inicio.
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

import {
  definirServicoAtivo,
  salvarCategoria,
  salvarProdutosDoServico,
  salvarServico,
} from "./actions";

const ID = "5b0c1d52-3c4e-4f6a-8b7d-1a2b3c4d5e6f";
const PRODUTO_A = "a1111111-1111-4111-8111-111111111111";
const PRODUTO_B = "b2222222-2222-4222-8222-222222222222";
const PRODUTO_C = "c3333333-3333-4333-8333-333333333333";

const servico = {
  nome: "Limpeza de pele",
  categoriaId: ID,
  descricao: "",
  duracaoMin: 60,
  precoCentavos: 15000,
  permiteOnline: true,
  exigeAvaliacao: true,
  diasRetorno: null,
};

beforeEach(() => {
  perfilAtual = "dona";
  falso = criarSupabaseFalso();
  exigirPerfil.mockClear();
  createClient.mockClear();
});

const escritas: [string, () => Promise<unknown>][] = [
  ["salvarCategoria", () => salvarCategoria({ nome: "Facial" })],
  ["salvarServico", () => salvarServico(servico)],
  ["definirServicoAtivo", () => definirServicoAtivo(ID, false)],
  ["salvarProdutosDoServico", () => salvarProdutosDoServico(ID, [])],
];

describe("guarda de perfil nas escritas de serviços", () => {
  for (const perfil of ["recepcao", "profissional"] as const) {
    for (const [nome, chamar] of escritas) {
      it(`${nome} como ${perfil} é barrada e não toca no banco`, async () => {
        perfilAtual = perfil;
        await expect(chamar()).rejects.toThrow("REDIRECT:/inicio");
        expect(exigirPerfil).toHaveBeenCalledWith("dona");
        expect(createClient).not.toHaveBeenCalled();
        expect(falso.chamadas).toHaveLength(0);
      });
    }
  }

  it("sem login redireciona para /login", async () => {
    perfilAtual = null;
    await expect(salvarServico(servico)).rejects.toThrow("REDIRECT:/login");
    expect(createClient).not.toHaveBeenCalled();
  });
});

describe("salvarCategoria", () => {
  it("insere categoria nova", async () => {
    const r = await salvarCategoria({ nome: "  Facial " });
    expect(r).toEqual({ ok: true });
    expect(falso.chamadasDe("categorias_servico", "insert")[0].args[0]).toEqual({ nome: "Facial" });
  });

  it("atualiza categoria existente e avisa se não existir", async () => {
    expect(await salvarCategoria({ nome: "Corporal" }, ID)).toEqual({ ok: true });
    expect(falso.chamadasDe("categorias_servico", "update")).toHaveLength(1);

    falso.responder("categorias_servico", { data: [], error: null });
    const r = await salvarCategoria({ nome: "Corporal" }, ID);
    expect(r).toEqual({ ok: false, erro: "Categoria não encontrada." });
  });

  it("traduz nome duplicado", async () => {
    falso.responder("categorias_servico", { data: null, error: { code: "23505", message: "x" } });
    const r = await salvarCategoria({ nome: "Facial" });
    expect(r).toEqual({ ok: false, erro: "Já existe uma categoria com este nome." });
  });

  it("valida nome e id sem tocar no banco", async () => {
    expect((await salvarCategoria({ nome: " " })).ok).toBe(false);
    expect(await salvarCategoria({ nome: "Facial" }, "nao-uuid")).toEqual({
      ok: false,
      erro: "Categoria inválida.",
    });
    expect(falso.chamadas).toHaveLength(0);
  });
});

describe("salvarServico", () => {
  it("mapeia os campos para as colunas e não envia comissão", async () => {
    const r = await salvarServico(servico);
    expect(r).toEqual({ ok: true });
    const linha = falso.chamadasDe("servicos", "insert")[0].args[0] as Record<string, unknown>;
    expect(linha).toEqual({
      nome: "Limpeza de pele",
      categoria_id: ID,
      descricao: null,
      duracao_min: 60,
      preco_centavos: 15000,
      permite_online: true,
      exige_avaliacao: true,
      dias_retorno: null,
    });
  });

  it("rejeita duração inválida com mensagem e sem tocar no banco", async () => {
    const r = await salvarServico({ ...servico, duracaoMin: 7 });
    expect(r.ok).toBe(false);
    expect(falso.chamadas).toHaveLength(0);
  });

  it("edita por id e avisa se o serviço não existe", async () => {
    falso.responder("servicos", { data: [], error: null });
    expect(await salvarServico(servico, ID)).toEqual({ ok: false, erro: "Serviço não encontrado." });
    expect(await salvarServico(servico, "x")).toEqual({ ok: false, erro: "Serviço inválido." });
  });
});

describe("definirServicoAtivo", () => {
  it("grava ativo e rejeita id inválido", async () => {
    expect(await definirServicoAtivo(ID, false)).toEqual({ ok: true });
    expect(falso.chamadasDe("servicos", "update")[0].args[0]).toEqual({ ativo: false });
    expect((await definirServicoAtivo("x", false)).ok).toBe(false);
  });
});

describe("salvarProdutosDoServico", () => {
  it("rejeita produto repetido e quantidade <= 0 sem tocar no banco", async () => {
    const dup = await salvarProdutosDoServico(ID, [
      { produtoId: PRODUTO_A, quantidade: 1 },
      { produtoId: PRODUTO_A, quantidade: 2 },
    ]);
    expect(dup.ok).toBe(false);
    const zero = await salvarProdutosDoServico(ID, [{ produtoId: PRODUTO_A, quantidade: 0 }]);
    expect(zero.ok).toBe(false);
    expect(falso.chamadas).toHaveLength(0);
  });

  it("insere novos, atualiza quantidade alterada e remove os que saíram", async () => {
    falso.responder(
      "servico_produtos",
      {
        data: [
          { id: "l1", produto_id: PRODUTO_A, quantidade: 1 },
          { id: "l2", produto_id: PRODUTO_C, quantidade: 3 },
        ],
        error: null,
      },
      { data: null, error: null },
      { data: null, error: null },
    );
    const r = await salvarProdutosDoServico(ID, [
      { produtoId: PRODUTO_A, quantidade: 0.5 },
      { produtoId: PRODUTO_B, quantidade: 2 },
    ]);
    expect(r).toEqual({ ok: true });

    const upsert = falso.chamadasDe("servico_produtos", "upsert")[0];
    expect(upsert.args[0]).toEqual([
      { servico_id: ID, produto_id: PRODUTO_A, quantidade: 0.5 },
      { servico_id: ID, produto_id: PRODUTO_B, quantidade: 2 },
    ]);
    expect(upsert.args[1]).toEqual({ onConflict: "servico_id,produto_id" });
    const remocao = falso.chamadasDe("servico_produtos", "in")[0];
    expect(remocao.args).toEqual(["id", ["l2"]]);
  });

  it("não escreve nada quando a lista não mudou", async () => {
    falso.responder("servico_produtos", {
      data: [{ id: "l1", produto_id: PRODUTO_A, quantidade: 0.5 }],
      error: null,
    });
    const r = await salvarProdutosDoServico(ID, [{ produtoId: PRODUTO_A, quantidade: 0.5 }]);
    expect(r).toEqual({ ok: true });
    expect(falso.chamadasDe("servico_produtos", "upsert")).toHaveLength(0);
    expect(falso.chamadasDe("servico_produtos", "delete")).toHaveLength(0);
  });
});
