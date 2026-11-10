import { describe, expect, it } from "vitest";
import { MENSAGEM_ANEXO_RECUSADO, caminhoAnexo, extensaoDoAnexo } from "./anexo";

describe("extensaoDoAnexo", () => {
  it("aceita JPEG, PNG e PDF de até 5 MB", () => {
    expect(extensaoDoAnexo({ type: "image/jpeg", size: 1000 })).toBe("jpg");
    expect(extensaoDoAnexo({ type: "image/png", size: 5 * 1024 * 1024 })).toBe("png");
    expect(extensaoDoAnexo({ type: "application/pdf", size: 10 })).toBe("pdf");
  });

  it("recusa outro tipo, arquivo vazio ou maior que 5 MB", () => {
    expect(extensaoDoAnexo({ type: "image/heic", size: 10 })).toBeNull();
    expect(extensaoDoAnexo({ type: "", size: 10 })).toBeNull();
    expect(extensaoDoAnexo({ type: "application/pdf", size: 0 })).toBeNull();
    expect(extensaoDoAnexo({ type: "application/pdf", size: 5 * 1024 * 1024 + 1 })).toBeNull();
  });

  it("mensagem de recusa exata", () => {
    expect(MENSAGEM_ANEXO_RECUSADO).toBe("Escolha uma foto (JPEG ou PNG) ou um PDF de até 5 MB.");
  });
});

describe("caminhoAnexo", () => {
  it("contas_pagar/<uuid>.<ext>", () => {
    expect(caminhoAnexo("a0000000-0000-4000-8000-0000000000a1", "pdf")).toBe(
      "contas_pagar/a0000000-0000-4000-8000-0000000000a1.pdf",
    );
  });
});
