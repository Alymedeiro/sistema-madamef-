import { createHash } from "node:crypto";
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream, decodePDFRawStream } from "pdf-lib";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { gerarPdfTermo, rodapeDoTermo, textoSeguroWinAnsi, type DadosTermoPdf } from "./pdf-termo";

const U = "8e3f4a85-6f71-4c9d-9eaf-4d5e6f708192";
const PNG_1x1 = new Uint8Array(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  ),
);
const d: DadosTermoPdf = {
  identificador: U,
  titulo: "Termo Peeling",
  versao: 2,
  texto: "# Riscos\nVermelhidão.",
  clienteNome: "Ana Souza",
  clienteCpf: "52998224725",
  assinadoEm: new Date("2026-11-04T13:30:00Z"),
  dispositivo: "iPad · Safari",
  assinaturaPng: PNG_1x1,
};

describe("rodapeDoTermo", () => {
  it("monta as cinco linhas, com CPF formatado e horário de Brasília", () => {
    expect(rodapeDoTermo(d)).toEqual([
      "Cliente: Ana Souza — CPF 529.982.247-25",
      "Assinado em 04/11/2026 às 10:30 (horário de Brasília)",
      "Dispositivo: iPad · Safari",
      `Identificador: ${U}`,
      "Termo: Termo Peeling — versão 2",
    ]);
  });

  it("sem CPF, só o nome", () => {
    expect(rodapeDoTermo({ ...d, clienteCpf: null })[0]).toBe("Cliente: Ana Souza");
  });
});

describe("textoSeguroWinAnsi", () => {
  it("mantém acentos e troca o que está fora do WinAnsi", () => {
    expect(textoSeguroWinAnsi("Olá, ção 😀")).toBe("Olá, ção ?");
    expect(textoSeguroWinAnsi("ã ç é ê õ — “aspas” €")).toBe("ã ç é ê õ — “aspas” €");
    expect(textoSeguroWinAnsi("日本")).toBe("??");
  });
});

describe("gerarPdfTermo", () => {
  it("gera PDF com metadados e hash dos bytes salvos", async () => {
    const { pdf, hashSha256 } = await gerarPdfTermo(d);
    const doc = await PDFDocument.load(pdf);
    expect(doc.getTitle()).toBe("Termo Peeling — v2");
    expect(doc.getSubject()).toBe(U);
    // `load` sobrescreve o produtor por padrão; sem isso lemos o que foi gravado.
    const gravado = await PDFDocument.load(pdf, { updateMetadata: false });
    expect(gravado.getProducer()).toBe("Madame Fê Clinic");
    expect(gravado.getCreationDate()?.toISOString()).toBe("2026-11-04T13:30:00.000Z");
    expect(doc.getPageCount()).toBe(1);
    expect(hashSha256).toBe(createHash("sha256").update(pdf).digest("hex"));
    expect(hashSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("textos com acentos, itens e emoji não lançam", async () => {
    const texto =
      "# Atenção às orientações\nParágrafo com ã, ç, é, ê, õ e 😀.\n\n- Evitar exposição ao sol\n- Não usar ácidos";
    await expect(gerarPdfTermo({ ...d, texto, titulo: "Termo — ação 😀" })).resolves.toBeTruthy();
  });

  it("texto longo abre novas páginas", async () => {
    const { pdf } = await gerarPdfTermo({ ...d, texto: "Parágrafo longo.\n\n".repeat(300) });
    expect((await PDFDocument.load(pdf)).getPageCount()).toBeGreaterThan(1);
  });

  it("palavra gigante sem espaços quebra sem estourar", async () => {
    await expect(gerarPdfTermo({ ...d, texto: "x".repeat(2000) })).resolves.toBeTruthy();
  });
});

/** Texto desenhado (operadores Tj, em hex) e contagem de imagens, lidos do próprio PDF. */
async function conteudo(pdf: Uint8Array) {
  const doc = await PDFDocument.load(pdf);
  let texto = "";
  let imagens = 0;
  for (const pagina of doc.getPages()) {
    const res = pagina.node.Resources() as PDFDict;
    const xo = res.lookupMaybe(PDFName.of("XObject"), PDFDict);
    for (const [, ref] of xo?.entries() ?? []) {
      const o = doc.context.lookup(ref) as PDFRawStream;
      if (o.dict.get(PDFName.of("Subtype")) === PDFName.of("Image")) imagens++;
    }
    const cont = pagina.node.Contents();
    const fluxos = cont instanceof PDFArray ? cont.asArray().map((r) => doc.context.lookup(r)) : [cont];
    for (const f of fluxos) {
      const bytes = decodePDFRawStream(f as PDFRawStream).decode();
      const bruto = Buffer.from(bytes).toString("latin1");
      for (const m of bruto.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)) {
        // Fontes padrão: cada par hex é um byte WinAnsi (latin1 nos caracteres usados aqui).
        texto += Buffer.from(m[1], "hex").toString("latin1") + "\n";
      }
    }
  }
  return { texto, imagens };
}

describe("conteúdo do PDF", () => {
  it("traz título, texto, cliente, CPF, rodapé e exatamente uma imagem", async () => {
    const { pdf } = await gerarPdfTermo(d);
    const { texto, imagens } = await conteudo(pdf);
    expect(imagens).toBe(1);
    for (const esperado of [
      "Termo Peeling",
      "Riscos",
      "Vermelhid\u00e3o.",
      "Li e concordo com os termos acima.",
      "Cliente: Ana Souza \u2014 CPF 529.982.247-25".replace("\u2014", "\u0097"),
      "Assinado em 04/11/2026 \u00e0s 10:30 (hor\u00e1rio de Bras\u00edlia)",
      "Dispositivo: iPad \u00b7 Safari",
      `Identificador: ${U}`,
    ]) {
      expect(texto).toContain(esperado);
    }
  });
});
