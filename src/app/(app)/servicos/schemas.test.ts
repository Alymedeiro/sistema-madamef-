import { describe, expect, it } from "vitest";
import {
  categoriaSchema,
  produtosDoServicoSchema,
  servicoSchema,
} from "./schemas";

const CATEGORIA = "5b0c1d52-3c4e-4f6a-8b7d-1a2b3c4d5e6f";
const PRODUTO_A = "a1111111-1111-4111-8111-111111111111";
const PRODUTO_B = "b2222222-2222-4222-8222-222222222222";

const valido = {
  nome: "Limpeza de pele",
  categoriaId: CATEGORIA,
  descricao: "",
  duracaoMin: 60,
  precoCentavos: 15000,
  permiteOnline: false,
  exigeAvaliacao: false,
  diasRetorno: null,
};

describe("servicoSchema", () => {
  it("modeloTermoId: vazio ou ausente vira null; uuid passa; lixo é recusado", () => {
    const T = "6c1d2e63-4d5f-4a7b-9c8e-2b3c4d5e6f70";
    const dado = (v: unknown) => servicoSchema.safeParse({ ...valido, modeloTermoId: v });
    const r = dado("");
    expect(r.success && r.data.modeloTermoId).toBeNull();
    const nulo = dado(null);
    expect(nulo.success && nulo.data.modeloTermoId).toBeNull();
    const ausente = servicoSchema.safeParse(valido);
    expect(ausente.success && ausente.data.modeloTermoId).toBeNull();
    const ok = dado(T);
    expect(ok.success && ok.data.modeloTermoId).toBe(T);
    expect(dado("abc").success).toBe(false);
  });

  it("aceita um serviço válido", () => {
    const r = servicoSchema.safeParse(valido);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.descricao).toBeNull();
  });

  it("rejeita duração que não é múltiplo de 5", () => {
    expect(servicoSchema.safeParse({ ...valido, duracaoMin: 7 }).success).toBe(false);
  });

  it("rejeita duração 0, negativa e acima de 480", () => {
    expect(servicoSchema.safeParse({ ...valido, duracaoMin: 0 }).success).toBe(false);
    expect(servicoSchema.safeParse({ ...valido, duracaoMin: -5 }).success).toBe(false);
    expect(servicoSchema.safeParse({ ...valido, duracaoMin: 485 }).success).toBe(false);
  });

  it("aceita os limites 5 e 480", () => {
    expect(servicoSchema.safeParse({ ...valido, duracaoMin: 5 }).success).toBe(true);
    expect(servicoSchema.safeParse({ ...valido, duracaoMin: 480 }).success).toBe(true);
  });

  it("não tem comissão (R9): campo extra é descartado", () => {
    const r = servicoSchema.safeParse({ ...valido, comissaoPct: 30 });
    expect(r.success).toBe(true);
    if (r.success) expect("comissaoPct" in r.data).toBe(false);
  });

  it("aceita diasRetorno nulo, ausente ou inteiro >= 1", () => {
    expect(servicoSchema.safeParse({ ...valido, diasRetorno: null }).success).toBe(true);
    const { diasRetorno, ...semRetorno } = valido;
    void diasRetorno;
    const r = servicoSchema.safeParse(semRetorno);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.diasRetorno).toBeNull();
    expect(servicoSchema.safeParse({ ...valido, diasRetorno: 30 }).success).toBe(true);
  });

  it("rejeita diasRetorno 0, negativo ou fracionado", () => {
    expect(servicoSchema.safeParse({ ...valido, diasRetorno: 0 }).success).toBe(false);
    expect(servicoSchema.safeParse({ ...valido, diasRetorno: -3 }).success).toBe(false);
    expect(servicoSchema.safeParse({ ...valido, diasRetorno: 1.5 }).success).toBe(false);
  });

  it("aceita exigeAvaliacao junto com permiteOnline", () => {
    const r = servicoSchema.safeParse({ ...valido, exigeAvaliacao: true, permiteOnline: true });
    expect(r.success).toBe(true);
  });

  it("rejeita preço negativo ou fracionado, aceita 0", () => {
    expect(servicoSchema.safeParse({ ...valido, precoCentavos: -1 }).success).toBe(false);
    expect(servicoSchema.safeParse({ ...valido, precoCentavos: 10.5 }).success).toBe(false);
    expect(servicoSchema.safeParse({ ...valido, precoCentavos: 0 }).success).toBe(true);
  });

  it("exige nome e categoria válida", () => {
    expect(servicoSchema.safeParse({ ...valido, nome: "   " }).success).toBe(false);
    expect(servicoSchema.safeParse({ ...valido, categoriaId: "x" }).success).toBe(false);
    expect(servicoSchema.safeParse({ ...valido, categoriaId: "" }).success).toBe(false);
  });
});

describe("categoriaSchema", () => {
  it("apara o nome e rejeita vazio ou muito longo", () => {
    const r = categoriaSchema.safeParse({ nome: "  Facial " });
    expect(r.success && r.data.nome).toBe("Facial");
    expect(categoriaSchema.safeParse({ nome: " " }).success).toBe(false);
    expect(categoriaSchema.safeParse({ nome: "x".repeat(81) }).success).toBe(false);
  });
});

describe("produtosDoServicoSchema", () => {
  it("aceita quantidade decimal (0,5 ml)", () => {
    const r = produtosDoServicoSchema.safeParse([
      { produtoId: PRODUTO_A, quantidade: 0.5 },
      { produtoId: PRODUTO_B, quantidade: 2 },
    ]);
    expect(r.success).toBe(true);
  });

  it("aceita lista vazia (serviço sem produtos)", () => {
    expect(produtosDoServicoSchema.safeParse([]).success).toBe(true);
  });

  it("rejeita quantidade 0, negativa e com mais de 3 casas", () => {
    for (const quantidade of [0, -1, 0.0001]) {
      expect(
        produtosDoServicoSchema.safeParse([{ produtoId: PRODUTO_A, quantidade }]).success,
      ).toBe(false);
    }
  });

  it("rejeita produto repetido", () => {
    const r = produtosDoServicoSchema.safeParse([
      { produtoId: PRODUTO_A, quantidade: 1 },
      { produtoId: PRODUTO_A, quantidade: 2 },
    ]);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0].message).toMatch(/mais de uma vez/);
  });

  it("rejeita produtoId que não é UUID", () => {
    expect(
      produtosDoServicoSchema.safeParse([{ produtoId: "abc", quantidade: 1 }]).success,
    ).toBe(false);
  });
});
