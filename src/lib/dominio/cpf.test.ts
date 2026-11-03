import { describe, expect, it } from "vitest";
import { formatarCPF, limparCPF, validarCPF } from "./cpf";

describe("limparCPF", () => {
  it("mantém apenas dígitos", () => {
    expect(limparCPF("529.982.247-25")).toBe("52998224725");
    expect(limparCPF(" 529 982 247 25 ")).toBe("52998224725");
  });
});

describe("validarCPF", () => {
  it("aceita CPF válido com ou sem pontuação", () => {
    expect(validarCPF("529.982.247-25")).toBe(true);
    expect(validarCPF("52998224725")).toBe(true);
  });

  it("rejeita sequências repetidas", () => {
    expect(validarCPF("111.111.111-11")).toBe(false);
    expect(validarCPF("00000000000")).toBe(false);
  });

  it("rejeita dígitos verificadores errados", () => {
    expect(validarCPF("529.982.247-24")).toBe(false);
  });

  it("rejeita tamanho diferente de 11 dígitos", () => {
    expect(validarCPF("5299822472")).toBe(false);
    expect(validarCPF("529982247255")).toBe(false);
    expect(validarCPF("")).toBe(false);
  });
});

describe("formatarCPF", () => {
  it("formata 11 dígitos como 000.000.000-00", () => {
    expect(formatarCPF("52998224725")).toBe("529.982.247-25");
    expect(formatarCPF("529.982.247-25")).toBe("529.982.247-25");
  });

  it("devolve só os dígitos quando não tem 11", () => {
    expect(formatarCPF("1234")).toBe("1234");
  });
});
