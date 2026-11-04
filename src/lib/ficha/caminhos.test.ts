import { describe, expect, it } from "vitest";
import { caminhoArquivo, caminhoPertence } from "./caminhos";

const C = "c1111111-1111-4111-8111-111111111111";
const U = "a2222222-2222-4222-8222-222222222222";

describe("caminhos", () => {
  it("monta o caminho", () => {
    expect(caminhoArquivo(C, "fotos", U, "jpg")).toBe(
      `clientes/${C}/fotos/${U}.jpg`,
    );
  });
  it("confere cliente e área", () => {
    expect(caminhoPertence(`clientes/${C}/fotos/${U}.jpg`, C, "fotos")).toBe(
      true,
    );
    expect(caminhoPertence(`clientes/${C}/termos/${U}.pdf`, C, "fotos")).toBe(
      false,
    );
    expect(caminhoPertence(`clientes/${C}/fotos/../${U}.jpg`, C, "fotos")).toBe(
      false,
    );
    expect(caminhoPertence(`clientes/OUTRA/fotos/${U}.jpg`, C, "fotos")).toBe(
      false,
    );
    expect(caminhoPertence(`clientes/${C}/fotos/${U}.gif`, C, "fotos")).toBe(
      false,
    );
  });
});
