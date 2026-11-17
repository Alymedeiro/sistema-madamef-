import { describe, expect, it } from "vitest";
import {
  MENSAGEM_NAO_IMAGEM,
  MENSAGEM_ORIGINAL_GRANDE,
  caminhoFotoServico,
  caminhoFotoServicoValido,
  dimensoesFotoServico,
  exportarFotoServico,
  fotosPorServico,
  ordemComCapa,
  ordemMovida,
  rotuloContagemFotos,
  validarArquivoFotoServico,
  vagasFotos,
} from "./servicos-fotos";

const SERVICO = "5b0c1d52-3c4e-4f6a-8b7d-1a2b3c4d5e6f";
const FOTO = "a1111111-1111-4111-8111-111111111111";
const MB = 1024 * 1024;

describe("dimensoesFotoServico", () => {
  it("reduz paisagem para 1600 no maior lado mantendo a proporção", () => {
    expect(dimensoesFotoServico(4000, 3000)).toEqual({ largura: 1600, altura: 1200 });
  });
  it("reduz retrato pelo lado maior (altura)", () => {
    expect(dimensoesFotoServico(3024, 4032)).toEqual({ largura: 1200, altura: 1600 });
  });
  it("não amplia foto pequena nem a de exatamente 1600", () => {
    expect(dimensoesFotoServico(800, 600)).toEqual({ largura: 800, altura: 600 });
    expect(dimensoesFotoServico(1600, 900)).toEqual({ largura: 1600, altura: 900 });
  });
  it("arredonda e nunca chega a zero", () => {
    expect(dimensoesFotoServico(10000, 3)).toEqual({ largura: 1600, altura: 1 });
  });
});

describe("validarArquivoFotoServico", () => {
  it("aceita imagens até 10 MB", () => {
    expect(validarArquivoFotoServico({ type: "image/jpeg", size: 10 * MB })).toBeNull();
    expect(validarArquivoFotoServico({ type: "image/png", size: 1 })).toBeNull();
    expect(validarArquivoFotoServico({ type: "image/webp", size: 1 })).toBeNull();
  });
  it("recusa não-imagens (inclusive sem tipo)", () => {
    expect(validarArquivoFotoServico({ type: "application/pdf", size: 1 })).toBe(MENSAGEM_NAO_IMAGEM);
    expect(validarArquivoFotoServico({ type: "", size: 1 })).toBe(MENSAGEM_NAO_IMAGEM);
  });
  it("recusa original acima de 10 MB", () => {
    expect(validarArquivoFotoServico({ type: "image/jpeg", size: 10 * MB + 1 })).toBe(
      MENSAGEM_ORIGINAL_GRANDE,
    );
  });
});

describe("caminhos", () => {
  it("monta e confere servicos/<servico>/<uuid>.<ext>", () => {
    const c = caminhoFotoServico(SERVICO, FOTO, "webp");
    expect(c).toBe(`servicos/${SERVICO}/${FOTO}.webp`);
    expect(caminhoFotoServicoValido(SERVICO, c)).toBe(true);
    expect(caminhoFotoServicoValido(SERVICO, caminhoFotoServico(SERVICO, FOTO, "jpg"))).toBe(true);
  });
  it("recusa outro serviço, outra extensão ou subpasta", () => {
    expect(caminhoFotoServicoValido(FOTO, `servicos/${SERVICO}/${FOTO}.webp`)).toBe(false);
    expect(caminhoFotoServicoValido(SERVICO, `servicos/${SERVICO}/${FOTO}.png`)).toBe(false);
    expect(caminhoFotoServicoValido(SERVICO, `servicos/${SERVICO}/x/${FOTO}.webp`)).toBe(false);
    expect(caminhoFotoServicoValido(SERVICO, `../servicos/${SERVICO}/${FOTO}.webp`)).toBe(false);
  });
});

describe("contagem e ordem", () => {
  it("rótulo e vagas", () => {
    expect(rotuloContagemFotos(3)).toBe("3 de 5 fotos");
    expect(vagasFotos(3)).toBe(2);
    expect(vagasFotos(5)).toBe(0);
    expect(vagasFotos(7)).toBe(0);
  });
  it("tornar capa leva a foto para o início sem mudar as outras", () => {
    expect(ordemComCapa(["a", "b", "c"], "c")).toEqual(["c", "a", "b"]);
    expect(ordemComCapa(["a", "b"], "a")).toEqual(["a", "b"]);
    expect(ordemComCapa(["a", "b"], "z")).toEqual(["a", "b"]);
  });
  it("mover troca com a vizinha e para nas pontas", () => {
    expect(ordemMovida(["a", "b", "c"], "b", -1)).toEqual(["b", "a", "c"]);
    expect(ordemMovida(["a", "b", "c"], "b", 1)).toEqual(["a", "c", "b"]);
    expect(ordemMovida(["a", "b", "c"], "a", -1)).toEqual(["a", "b", "c"]);
    expect(ordemMovida(["a", "b", "c"], "c", 1)).toEqual(["a", "b", "c"]);
  });
});

describe("exportarFotoServico", () => {
  const blob = (tipo: string, tamanho = 10) => new Blob([new Uint8Array(tamanho)], { type: tipo });

  it("usa WebP 0,82 quando o navegador gera WebP", async () => {
    const pedidos: [string, number][] = [];
    const r = await exportarFotoServico(async (tipo, q) => {
      pedidos.push([tipo, q]);
      return blob(tipo);
    });
    expect(pedidos).toEqual([["image/webp", 0.82]]);
    expect(r.ext).toBe("webp");
    expect(r.contentType).toBe("image/webp");
  });

  it("cai para JPEG quando o navegador devolve PNG no lugar de WebP", async () => {
    const r = await exportarFotoServico(async (tipo) =>
      tipo === "image/webp" ? blob("image/png") : blob(tipo),
    );
    expect(r.ext).toBe("jpg");
    expect(r.contentType).toBe("image/jpeg");
  });

  it("cai para JPEG quando o WebP vem nulo; sem JPEG, erro amigável", async () => {
    const r = await exportarFotoServico(async (tipo) => (tipo === "image/webp" ? null : blob(tipo)));
    expect(r.ext).toBe("jpg");
    await expect(exportarFotoServico(async () => null)).rejects.toThrow(/Não foi possível ler/);
  });

  it("recusa resultado acima de 2 MB", async () => {
    await expect(
      exportarFotoServico(async (tipo) => blob(tipo, 2 * MB + 1)),
    ).rejects.toThrow(/grande demais/);
  });
});

describe("fotosPorServico", () => {
  it("agrupa por serviço com a capa (ordem 0) primeiro, mesmo fora de ordem", () => {
    const linha = (servico_id: string, caminho: string, ordem: number) => ({
      servico_id,
      caminho,
      ordem,
      largura: 1600,
      altura: 1200,
    });
    const m = fotosPorServico(
      [linha("s1", "b", 1), linha("s2", "x", 0), linha("s1", "a", 0)],
      (c) => `https://pub/${c}`,
    );
    expect(m.get("s1")?.map((f) => f.url)).toEqual(["https://pub/a", "https://pub/b"]);
    expect(m.get("s2")).toEqual([{ url: "https://pub/x", largura: 1600, altura: 1200 }]);
    expect(m.get("s3")).toBeUndefined();
  });
});
