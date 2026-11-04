import { describe, expect, it } from "vitest";
import {
  MAX_BYTES_FOTO,
  MAX_LADO_FOTO,
  QUALIDADES_JPEG,
  ROTULO_TIPO_FOTO,
  agruparFotos,
  arquivoDeImagemAceito,
  dimensoesAlvo,
} from "./fotos";

describe("dimensoesAlvo", () => {
  it("reduz mantendo a proporção", () => {
    expect(dimensoesAlvo(6000, 4000)).toEqual({ largura: 2560, altura: 1707 });
    expect(dimensoesAlvo(3000, 4000)).toEqual({ largura: 1920, altura: 2560 });
  });
  it("nunca amplia", () => {
    expect(dimensoesAlvo(800, 600)).toEqual({ largura: 800, altura: 600 });
    expect(dimensoesAlvo(2560, 2560)).toEqual({ largura: 2560, altura: 2560 });
  });
  it("respeita outro limite e não zera um lado", () => {
    expect(dimensoesAlvo(1000, 500, 100)).toEqual({ largura: 100, altura: 50 });
    expect(dimensoesAlvo(10000, 1, 100)).toEqual({ largura: 100, altura: 1 });
  });
});

describe("arquivoDeImagemAceito", () => {
  it("aceita JPEG, PNG e HEIC/HEIF", () => {
    for (const type of ["image/jpeg", "image/png", "image/heic", "image/heif"]) {
      expect(arquivoDeImagemAceito({ type, name: "x" })).toBe(true);
    }
    expect(arquivoDeImagemAceito({ type: "image/heic", name: "IMG_0001.HEIC" })).toBe(true);
  });
  it("aceita pela extensão quando o tipo vem vazio", () => {
    for (const nome of ["a.heic", "a.HEIF", "a.jpg", "a.jpeg", "a.png"]) {
      expect(arquivoDeImagemAceito({ type: "", name: nome })).toBe(true);
    }
  });
  it("recusa PDF e outros formatos, mesmo com extensão de imagem e tipo diferente", () => {
    expect(arquivoDeImagemAceito({ type: "application/pdf", name: "exame.pdf" })).toBe(false);
    expect(arquivoDeImagemAceito({ type: "application/pdf", name: "foto.jpg" })).toBe(false);
    expect(arquivoDeImagemAceito({ type: "image/gif", name: "a.gif" })).toBe(false);
    expect(arquivoDeImagemAceito({ type: "", name: "exame.pdf" })).toBe(false);
    expect(arquivoDeImagemAceito({ type: "", name: "semextensao" })).toBe(false);
  });
});

describe("constantes", () => {
  it("valores combinados", () => {
    expect(MAX_LADO_FOTO).toBe(2560);
    expect(MAX_BYTES_FOTO).toBe(5 * 1024 * 1024);
    expect(QUALIDADES_JPEG).toEqual([0.85, 0.75, 0.65, 0.5]);
    expect(ROTULO_TIPO_FOTO).toEqual({ antes: "Antes", depois: "Depois", evolucao: "Evolução" });
  });
});

describe("agruparFotos", () => {
  it("agrupa por dia de São Paulo (mais recente primeiro) e serviço", () => {
    const g = agruparFotos([
      { tiradaEm: "2026-11-04T02:00:00Z", servicoNome: "Peeling" },
      { tiradaEm: "2026-11-04T15:00:00Z", servicoNome: "Peeling" },
    ]);
    expect(g.map((x) => x.data)).toEqual(["2026-11-04", "2026-11-03"]);
  });
  it("separa serviços no mesmo dia e junta fotos iguais", () => {
    const g = agruparFotos([
      { tiradaEm: "2026-11-04T15:00:00Z", servicoNome: "Peeling" },
      { tiradaEm: "2026-11-04T15:05:00Z", servicoNome: "Peeling" },
      { tiradaEm: "2026-11-04T16:00:00Z", servicoNome: null },
    ]);
    expect(g).toHaveLength(2);
    expect(g.find((x) => x.servicoNome === "Peeling")?.fotos).toHaveLength(2);
    expect(agruparFotos([])).toEqual([]);
  });
});
