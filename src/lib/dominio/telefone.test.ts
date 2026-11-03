import { describe, expect, it } from "vitest";
import { formatarTelefone, normalizarWhatsApp } from "./telefone";

describe("normalizarWhatsApp", () => {
  it("aceita celular com DDD em qualquer formato e devolve 55 + DDD + número", () => {
    for (const e of [
      "(11) 98765-4321",
      "11987654321",
      "+55 11 98765-4321",
      "5511987654321",
    ])
      expect(normalizarWhatsApp(e)).toBe("5511987654321");
  });

  it("aceita fixo com 10 dígitos", () => {
    expect(normalizarWhatsApp("(11) 3456-7890")).toBe("551134567890");
    expect(normalizarWhatsApp("+55 11 3456-7890")).toBe("551134567890");
  });

  it("não confunde DDD 55 com código do país", () => {
    // DDD 55 (RS) é nacional: o resultado é 55 + 55 + número.
    expect(normalizarWhatsApp("(55) 98765-4321")).toBe("5555987654321");
    expect(normalizarWhatsApp("(55) 3456-7890")).toBe("555534567890");
  });

  it("aceita o 0 de tronco antes do DDD (uma vez só)", () => {
    expect(normalizarWhatsApp("(011) 98765-4321")).toBe("5511987654321");
    expect(normalizarWhatsApp("011987654321")).toBe("5511987654321");
    expect(normalizarWhatsApp("(011) 3456-7890")).toBe("551134567890");
    expect(normalizarWhatsApp("0011987654321")).toBeNull();
  });

  it("rejeita número sem DDD", () => {
    expect(normalizarWhatsApp("98765-4321")).toBeNull();
  });

  it("rejeita vazio, texto e tamanhos inválidos", () => {
    expect(normalizarWhatsApp("")).toBeNull();
    expect(normalizarWhatsApp("abc")).toBeNull();
    expect(normalizarWhatsApp("119876543210")).toBeNull();
  });
});

describe("formatarTelefone", () => {
  it("formata celular de 11 dígitos", () => {
    expect(formatarTelefone("5511987654321")).toBe("(11) 98765-4321");
  });

  it("formata fixo de 10 dígitos", () => {
    expect(formatarTelefone("551134567890")).toBe("(11) 3456-7890");
  });

  it("devolve a entrada sem formatar quando não reconhece o número", () => {
    expect(formatarTelefone("123")).toBe("123");
  });
});
