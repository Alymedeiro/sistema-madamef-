import { describe, expect, it } from "vitest";
import { MAX_BYTES_FOTO } from "@/lib/dominio/fotos";
import { MENSAGEM_FOTO_ILEGIVEL } from "@/lib/dominio/fotos";
import { comprimirAteCaber, precisaConverterHeic } from "./converter";

const blob = (n: number) => ({ size: n }) as Blob;

describe("comprimirAteCaber", () => {
  it("usa a primeira qualidade que cabe", async () => {
    const usadas: number[] = [];
    const r = await comprimirAteCaber(async (q) => {
      usadas.push(q);
      return blob(q > 0.8 ? MAX_BYTES_FOTO + 1 : 1000);
    });
    expect(usadas).toEqual([0.85, 0.75]);
    expect(r.size).toBe(1000);
  });
  it("aceita exatamente o limite", async () => {
    const r = await comprimirAteCaber(async () => blob(MAX_BYTES_FOTO));
    expect(r.size).toBe(MAX_BYTES_FOTO);
  });
  it("não coube em nenhuma qualidade: erro amigável", async () => {
    const usadas: number[] = [];
    await expect(
      comprimirAteCaber(async (q) => {
        usadas.push(q);
        return blob(MAX_BYTES_FOTO + 1);
      }),
    ).rejects.toThrow(MENSAGEM_FOTO_ILEGIVEL);
    expect(usadas).toEqual([0.85, 0.75, 0.65, 0.5]);
  });
  it("canvas que não gera blob (null): erro amigável", async () => {
    await expect(comprimirAteCaber(async () => null)).rejects.toThrow(MENSAGEM_FOTO_ILEGIVEL);
  });
});

describe("precisaConverterHeic", () => {
  it("só tenta HEIC quando a decodificação nativa falhou e o arquivo é HEIC/HEIF", () => {
    expect(precisaConverterHeic({ type: "image/heic", name: "a.heic" })).toBe(true);
    expect(precisaConverterHeic({ type: "", name: "a.HEIF" })).toBe(true);
    expect(precisaConverterHeic({ type: "image/jpeg", name: "a.jpg" })).toBe(false);
    expect(precisaConverterHeic({ type: "application/pdf", name: "a.pdf" })).toBe(false);
  });
});
