// Guarda de contraste dos tokens do tema (WCAG 1.4.11: bordas de campos e
// indicador de foco ≥ 3:1 sobre as superfícies onde aparecem).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("./globals.css", import.meta.url), "utf8");

function valor(nome: string): string {
  const m = new RegExp(`${nome}:\\s*([^;]+);`).exec(css);
  if (!m) throw new Error(`token ${nome} não encontrado`);
  const v = m[1].trim();
  const ref = /^var\((--[\w-]+)\)$/.exec(v);
  return ref ? valor(ref[1]) : v;
}

function luminancia(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contraste(a: string, b: string): number {
  const [x, y] = [luminancia(a), luminancia(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

describe("tokens de contraste", () => {
  it.each(["--border", "--input"])("%s ≥ 3:1 sobre branco e blush", (token) => {
    const cor = valor(token);
    expect(cor).toMatch(/^#[0-9a-f]{6}$/i);
    expect(contraste(cor, valor("--color-branco"))).toBeGreaterThanOrEqual(3);
    expect(contraste(cor, valor("--color-blush"))).toBeGreaterThanOrEqual(3);
  });

  it("--ring é uma cor sólida (sem transparência) com ≥ 3:1 sobre branco e blush", () => {
    const cor = valor("--ring");
    expect(cor).toMatch(/^#[0-9a-f]{6}$/i);
    expect(contraste(cor, valor("--color-branco"))).toBeGreaterThanOrEqual(3);
    expect(contraste(cor, valor("--color-blush"))).toBeGreaterThanOrEqual(3);
  });
});
