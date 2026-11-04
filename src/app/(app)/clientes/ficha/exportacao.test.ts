import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { arquivosDaExportacao, nomeArquivoExportacao } from "./exportacao";

describe("nomeArquivoExportacao", () => {
  it("usa slug sem acento e a data", () => {
    expect(nomeArquivoExportacao("Ana Lúcia de Souza", "2026-11-04")).toBe(
      "madame-fe-ana-lucia-de-souza-2026-11-04.zip",
    );
  });
  it("não deixa caracteres perigosos nem nome vazio", () => {
    expect(nomeArquivoExportacao('../../etc/"passwd"\r\n', "2026-11-04")).toBe(
      "madame-fe-etc-passwd-2026-11-04.zip",
    );
    expect(nomeArquivoExportacao("???", "2026-11-04")).toBe("madame-fe-cliente-2026-11-04.zip");
  });
});

describe("arquivosDaExportacao", () => {
  it("mapeia os arquivos do Storage para caminhos dentro do ZIP", () => {
    expect(
      arquivosDaExportacao({
        anamneses: [{ id: "A1", assinatura_path: "p1" }],
        termos: [{ id: "T1", pdf_path: "p2", assinatura_path: "p3" }],
        fotos: [{ id: "F1", path: "p4" }],
      }),
    ).toEqual([
      { noZip: "anamneses/A1-assinatura.png", noStorage: "p1" },
      { noZip: "termos/T1.pdf", noStorage: "p2" },
      { noZip: "termos/T1-assinatura.png", noStorage: "p3" },
      { noZip: "fotos/F1.jpg", noStorage: "p4" },
    ]);
  });
  it("sanitiza ids para não sair da pasta", () => {
    const [a] = arquivosDaExportacao({
      anamneses: [{ id: "../x/y", assinatura_path: "p" }],
      termos: [],
      fotos: [],
    });
    expect(a.noZip).toBe("anamneses/___x_y-assinatura.png");
  });
});
