import { describe, expect, it } from "vitest";
import { mensagemErroBanco } from "./erros-db";

describe("mensagemErroBanco", () => {
  it("sobreposição de horário (exclusion violation)", () => {
    expect(mensagemErroBanco({ code: "23P01" })).toBe(
      "Este horário já está ocupado para esta profissional.",
    );
  });

  it("CPF duplicado", () => {
    expect(
      mensagemErroBanco({
        code: "23505",
        message: 'duplicate key ... "clientes_cpf_key"',
      }),
    ).toBe("Já existe uma cliente cadastrada com este CPF.");
  });

  it("duplicidade genérica", () => {
    expect(mensagemErroBanco({ code: "23505", message: "duplicate key" })).toBe(
      "Já existe um registro com estes dados.",
    );
  });

  it("falta de permissão (RLS)", () => {
    expect(mensagemErroBanco({ code: "42501" })).toBe(
      "Você não tem permissão para esta ação.",
    );
  });

  it("regra de negócio levantada pelo banco (P0001) mostra a mensagem", () => {
    expect(
      mensagemErroBanco({
        code: "P0001",
        message: "Abra o caixa do dia antes de lançar pagamentos",
      }),
    ).toBe("Abra o caixa do dia antes de lançar pagamentos");
  });

  it("P0001 sem mensagem cai no texto genérico", () => {
    expect(mensagemErroBanco({ code: "P0001" })).toBe(
      "Não foi possível concluir. Tente novamente.",
    );
  });

  it("erro desconhecido não vaza detalhes técnicos", () => {
    expect(mensagemErroBanco({ code: "XX000", message: "internal boom" })).toBe(
      "Não foi possível concluir. Tente novamente.",
    );
    expect(mensagemErroBanco({})).toBe(
      "Não foi possível concluir. Tente novamente.",
    );
  });
});
