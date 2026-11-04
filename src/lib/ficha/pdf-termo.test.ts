import { createHash } from "node:crypto";
import { PDFDocument } from "pdf-lib";
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
