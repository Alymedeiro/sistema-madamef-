import { describe, expect, it } from "vitest";
import { previaMensagem } from "./previa";

describe("previaMensagem", () => {
  it("renderiza as variáveis com os dados de exemplo", () => {
    const agora = new Date("2026-11-11T15:00:00Z");
    expect(
      previaMensagem("Oi, {nome}! {servico} com {profissional} em {data} às {hora}. {clinica}", "Madame Fê", agora),
    ).toBe("Oi, Maria! Limpeza de pele com Ana em 12/11 às 14:30. Madame Fê");
  });

  it("variável desconhecida fica literal", () => {
    expect(previaMensagem("{xpto} {nome}", "C")).toBe("{xpto} Maria");
  });
});
