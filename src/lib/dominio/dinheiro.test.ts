import { describe, expect, it } from "vitest";
import { formatarBRL, parseBRL } from "./dinheiro";

describe("formatarBRL", () => {
  it("formata centavos em reais no padrão brasileiro", () => {
    expect(formatarBRL(123456)).toBe("R$ 1.234,56");
    expect(formatarBRL(0)).toBe("R$ 0,00");
  });

  it("usa espaço ASCII (não NBSP) após R$", () => {
    expect(formatarBRL(8000)).toBe("R$ 80,00");
    expect(formatarBRL(8000).includes(" ")).toBe(false);
  });
});

describe("parseBRL", () => {
  it("aceita formato brasileiro com milhar e vírgula decimal", () => {
    expect(parseBRL("1.234,56")).toBe(123456);
  });

  it("aceita vírgula decimal com 1 dígito", () => {
    expect(parseBRL("1234,5")).toBe(123450);
  });

  it("aceita prefixo R$ e valor inteiro", () => {
    expect(parseBRL("R$ 80")).toBe(8000);
    expect(parseBRL("R$80")).toBe(8000);
  });

  it("aceita zero", () => {
    expect(parseBRL("0")).toBe(0);
    expect(parseBRL("0,00")).toBe(0);
  });

  it("rejeita texto vazio, texto não numérico e negativos", () => {
    expect(parseBRL("")).toBeNull();
    expect(parseBRL("   ")).toBeNull();
    expect(parseBRL("abc")).toBeNull();
    expect(parseBRL("-5")).toBeNull();
  });

  it("rejeita ponto decimal (ambíguo) e milhar mal agrupado", () => {
    expect(parseBRL("1234.56")).toBeNull();
    expect(parseBRL("1.23")).toBeNull();
    expect(parseBRL("1.234,5.6")).toBeNull();
  });
});
