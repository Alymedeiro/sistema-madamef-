import { describe, expect, it } from "vitest";
import { produtoNovoSchema, produtoSchema } from "./schemas";

const valido = {
  nome: "Ácido hialurônico",
  unidade: "ml",
  precoVendaCentavos: null,
  custoCentavos: 12000,
  estoqueMinimo: 2,
};

describe("produtoSchema", () => {
  it("aceita um produto válido", () => {
    expect(produtoSchema.safeParse(valido).success).toBe(true);
  });

  it("edição não carrega estoque: estoqueAtual/estoqueInicial são descartados", () => {
    const r = produtoSchema.safeParse({ ...valido, estoqueAtual: 10, estoqueInicial: 3 });
    expect(r.success).toBe(true);
    if (r.success) {
      expect("estoqueAtual" in r.data).toBe(false);
      expect("estoqueInicial" in r.data).toBe(false);
    }
  });

  it("criação: estoque inicial ausente vira 0; decimal até 3 casas; não negativo", () => {
    const ausente = produtoNovoSchema.safeParse(valido);
    expect(ausente.success && ausente.data.estoqueInicial).toBe(0);
    expect(produtoNovoSchema.safeParse({ ...valido, estoqueInicial: 0.125 }).success).toBe(true);
    expect(produtoNovoSchema.safeParse({ ...valido, estoqueInicial: 0.1255 }).success).toBe(false);
    expect(produtoNovoSchema.safeParse({ ...valido, estoqueInicial: -1 }).success).toBe(false);
  });

  it("rejeita estoque mínimo negativo", () => {
    expect(produtoSchema.safeParse({ ...valido, estoqueMinimo: -1 }).success).toBe(false);
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
