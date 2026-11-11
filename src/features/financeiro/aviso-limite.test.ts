import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AvisoLimite } from "./aviso-limite";

const html = (n: number) => renderToStaticMarkup(AvisoLimite({ linhas: n }) ?? "");

describe("AvisoLimite", () => {
  it("com 500 linhas (o limite da consulta) pede para refinar o filtro", () => {
    expect(html(500)).toContain("Mostrando as 500 primeiras — refine o filtro.");
  });

  it("abaixo do limite não mostra nada", () => {
    expect(html(499)).toBe("");
    expect(html(0)).toBe("");
  });
});
