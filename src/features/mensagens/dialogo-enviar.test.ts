import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/(app)/mensagens/actions", () => ({ enviarWhatsApp: vi.fn() }));

import { textoInicialAvulsa } from "./dialogo-enviar";

describe("textoInicialAvulsa", () => {
  it("prefixa com o primeiro nome", () => {
    expect(textoInicialAvulsa("  Maria   Clara Souza ")).toBe("Oi, Maria! ");
    expect(textoInicialAvulsa("")).toBe("Oi! ");
  });
});
