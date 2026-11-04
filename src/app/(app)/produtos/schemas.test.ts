import { describe, expect, it } from "vitest";
import { produtoSchema } from "./schemas";

const valido = {
  nome: "Ácido hialurônico",
  unidade: "ml",
  precoVendaCentavos: null,
  custoCentavos: 12000,
  estoqueAtual: 10,
  estoqueMinimo: 2,
};

describe("produtoSchema", () => {
  it("aceita um produto válido", () => {
    expect(produtoSchema.safeParse(valido).success).toBe(true);
  });

  it("aceita estoque decimal até 3 casas e rejeita mais", () => {
    expect(produtoSchema.safeParse({ ...valido, estoqueAtual: 0.125 }).success).toBe(true);
    expect(produtoSchema.safeParse({ ...valido, estoqueAtual: 0.1255 }).success).toBe(false);
  });

  it("rejeita estoque mínimo negativo e estoque atual negativo", () => {
    expect(produtoSchema.safeParse({ ...valido, estoqueMinimo: -1 }).success).toBe(false);
    expect(produtoSchema.safeParse({ ...valido, estoqueAtual: -1 }).success).toBe(false);
  });

  it("rejeita custo negativo ou fracionado, aceita 0", () => {
    expect(produtoSchema.safeParse({ ...valido, custoCentavos: -1 }).success).toBe(false);
    expect(produtoSchema.safeParse({ ...valido, custoCentavos: 1.5 }).success).toBe(false);
    expect(produtoSchema.safeParse({ ...valido, custoCentavos: 0 }).success).toBe(true);
  });

  it("preço de venda é opcional, mas não pode ser negativo", () => {
    expect(produtoSchema.safeParse({ ...valido, precoVendaCentavos: 5000 }).success).toBe(true);
    expect(produtoSchema.safeParse({ ...valido, precoVendaCentavos: -1 }).success).toBe(false);
    const { precoVendaCentavos, ...sem } = valido;
    void precoVendaCentavos;
    const r = produtoSchema.safeParse(sem);
    expect(r.success && r.data.precoVendaCentavos).toBeNull();
  });

  it("exige nome e unidade", () => {
    expect(produtoSchema.safeParse({ ...valido, nome: " " }).success).toBe(false);
    expect(produtoSchema.safeParse({ ...valido, unidade: " " }).success).toBe(false);
  });
});
