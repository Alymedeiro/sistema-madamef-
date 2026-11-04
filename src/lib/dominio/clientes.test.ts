import { describe, expect, it } from "vitest";
import { classificarTermoBusca, escaparLike, normalizarTextoBusca } from "./clientes";

describe("normalizarTextoBusca", () => {
  it("tira acentos, põe em minúsculas e junta espaços", () => {
    expect(normalizarTextoBusca("  Ânã   CONCEIÇÃO ")).toBe("ana conceicao");
    expect(normalizarTextoBusca("José Müller")).toBe("jose muller");
  });
});

describe("escaparLike", () => {
  it("escapa %, _ e a contrabarra digitados pela usuária", () => {
    expect(escaparLike("50%_a\\b")).toBe("50\\%\\_a\\\\b");
    expect(escaparLike("maria")).toBe("maria");
  });
});

describe("classificarTermoBusca", () => {
  it("termo vazio ou com menos de 2 caracteres não busca", () => {
    for (const t of ["", "   ", "a", " a "]) {
      expect(classificarTermoBusca(t)).toEqual({ tipo: "vazia" });
    }
  });

  it("nome: normaliza sem acento, minúsculo", () => {
    expect(classificarTermoBusca(" Ânã Conceição ")).toEqual({
      tipo: "nome",
      texto: "ana conceicao",
    });
    expect(classificarTermoBusca("ana")).toEqual({ tipo: "nome", texto: "ana" });
  });

  it("poucos dígitos misturados a letras continuam sendo nome", () => {
    expect(classificarTermoBusca("ana 98765")).toEqual({ tipo: "nome", texto: "ana 98765" });
    expect(classificarTermoBusca("987")).toEqual({ tipo: "nome", texto: "987" });
  });

  it("pedaço de telefone (4+ dígitos, sem letras) busca por número", () => {
    expect(classificarTermoBusca("98765")).toEqual({ tipo: "numero", digitos: ["98765"] });
    expect(classificarTermoBusca("98765-4321")).toEqual({ tipo: "numero", digitos: ["987654321"] });
  });

  it("telefone em qualquer formato chega aos mesmos dígitos", () => {
    expect(classificarTermoBusca("(11) 98765-4321")).toEqual({
      tipo: "numero",
      digitos: ["11987654321"],
    });
    expect(classificarTermoBusca("11987654321")).toEqual({
      tipo: "numero",
      digitos: ["11987654321"],
    });
  });

  it("com 55 e 12–13 dígitos tenta também sem o 55", () => {
    expect(classificarTermoBusca("+55 11 98765-4321")).toEqual({
      tipo: "numero",
      digitos: ["5511987654321", "11987654321"],
    });
    expect(classificarTermoBusca("55 11 3456-7890")).toEqual({
      tipo: "numero",
      digitos: ["551134567890", "1134567890"],
    });
  });

  it("55 com menos de 12 dígitos não é tratado como código do país", () => {
    expect(classificarTermoBusca("55119876")).toEqual({ tipo: "numero", digitos: ["55119876"] });
  });

  it("0 de tronco no começo é descartado (uma vez)", () => {
    expect(classificarTermoBusca("011987654321")).toEqual({
      tipo: "numero",
      digitos: ["11987654321"],
    });
    expect(classificarTermoBusca("(011) 98765-4321")).toEqual({
      tipo: "numero",
      digitos: ["11987654321"],
    });
  });

  it("CPF com ou sem pontuação vira os mesmos dígitos", () => {
    for (const t of ["529.982.247-25", "52998224725"]) {
      expect(classificarTermoBusca(t)).toEqual({ tipo: "numero", digitos: ["52998224725"] });
    }
  });

  it("8+ dígitos com letras também busca por número", () => {
    expect(classificarTermoBusca("tel 11987654321")).toEqual({
      tipo: "numero",
      digitos: ["11987654321"],
    });
  });
});
