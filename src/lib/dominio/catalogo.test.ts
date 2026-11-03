import { describe, expect, it } from "vitest";
import {
  estoqueBaixo,
  formatarDuracao,
  formatarQuantidade,
  parseQuantidade,
  temNoMaximoCasas,
} from "./catalogo";

describe("parseQuantidade", () => {
  it("aceita inteiro, vírgula e ponto decimal", () => {
    expect(parseQuantidade("2")).toBe(2);
    expect(parseQuantidade("0,5")).toBe(0.5);
    expect(parseQuantidade(" 1,25 ")).toBe(1.25);
    expect(parseQuantidade("0.5")).toBe(0.5);
    expect(parseQuantidade("1,125")).toBe(1.125);
  });

  it("devolve null para vazio, texto, negativo e formato quebrado", () => {
    expect(parseQuantidade("")).toBeNull();
    expect(parseQuantidade("   ")).toBeNull();
    expect(parseQuantidade("abc")).toBeNull();
    expect(parseQuantidade("-1")).toBeNull();
    expect(parseQuantidade("1,2,3")).toBeNull();
    expect(parseQuantidade("1e3")).toBeNull();
    expect(parseQuantidade(",5")).toBeNull();
  });
});

describe("temNoMaximoCasas", () => {
  it("confere casas decimais sem erro de ponto flutuante", () => {
    expect(temNoMaximoCasas(0.5, 3)).toBe(true);
    expect(temNoMaximoCasas(1.125, 3)).toBe(true);
    expect(temNoMaximoCasas(0.1 + 0.2, 3)).toBe(true);
    expect(temNoMaximoCasas(1.1255, 3)).toBe(false);
    expect(temNoMaximoCasas(10, 0)).toBe(true);
    expect(temNoMaximoCasas(10.5, 0)).toBe(false);
  });
});

describe("formatarQuantidade", () => {
  it("usa vírgula e remove zeros à direita", () => {
    expect(formatarQuantidade(2)).toBe("2");
    expect(formatarQuantidade(0.5)).toBe("0,5");
    expect(formatarQuantidade(1.125)).toBe("1,125");
    expect(formatarQuantidade(1000)).toBe("1.000");
  });
});

describe("estoqueBaixo", () => {
  it("é verdadeiro só quando atual < mínimo", () => {
    expect(estoqueBaixo(2, 5)).toBe(true);
    expect(estoqueBaixo(5, 5)).toBe(false);
    expect(estoqueBaixo(6, 5)).toBe(false);
    expect(estoqueBaixo(0, 0)).toBe(false);
    expect(estoqueBaixo(-1, 0)).toBe(true);
  });
});

describe("formatarDuracao", () => {
  it("mostra minutos e horas", () => {
    expect(formatarDuracao(45)).toBe("45 min");
    expect(formatarDuracao(60)).toBe("1 h");
    expect(formatarDuracao(90)).toBe("1 h 30 min");
    expect(formatarDuracao(480)).toBe("8 h");
  });
});
