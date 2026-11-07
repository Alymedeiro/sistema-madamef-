import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MAX_BYTES_ENTRADA_FOTO,
  MAX_BYTES_FOTO,
  MENSAGEM_FOTO_GRANDE,
  MENSAGEM_FOTO_ILEGIVEL,
} from "@/lib/dominio/fotos";
import { comprimirAteCaber, converterParaJpeg, precisaConverterHeic } from "./converter";

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

describe("converterParaJpeg", () => {
  afterEach(() => vi.unstubAllGlobals());

  /** Canvas falso que registra a ordem das operações de desenho. */
  function prepararCanvas() {
    const ops: string[] = [];
    const ctx = {
      set fillStyle(v: string) {
        ops.push(`fillStyle=${v}`);
      },
      fillRect: (...a: number[]) => ops.push(`fillRect ${a.join(" ")}`),
      drawImage: () => ops.push("drawImage"),
    };
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => ctx,
      toBlob: (cb: (b: Blob | null) => void) => cb({ size: 1000, type: "image/jpeg" } as Blob),
    };
    const fechar = vi.fn();
    const decodificar = vi.fn(async () => ({ width: 100, height: 50, close: fechar }));
    vi.stubGlobal("document", { createElement: () => canvas });
    vi.stubGlobal("createImageBitmap", decodificar);
    return { ops, decodificar, fechar };
  }

  it("pinta o fundo de branco antes de desenhar (PNG transparente não fica preto)", async () => {
    const { ops, fechar } = prepararCanvas();
    const r = await converterParaJpeg(new File([new Uint8Array(10)], "a.png", { type: "image/png" }));
    expect(r.size).toBe(1000);
    expect(ops).toEqual(["fillStyle=#ffffff", "fillRect 0 0 100 50", "drawImage"]);
    expect(fechar).toHaveBeenCalled();
  });

  it("arquivo acima de 30 MB é recusado antes de decodificar", async () => {
    const { decodificar } = prepararCanvas();
    expect(MAX_BYTES_ENTRADA_FOTO).toBe(30 * 1024 * 1024);
    const grande = { name: "a.jpg", type: "image/jpeg", size: MAX_BYTES_ENTRADA_FOTO + 1 } as File;
    await expect(converterParaJpeg(grande)).rejects.toThrow(MENSAGEM_FOTO_GRANDE);
    expect(decodificar).not.toHaveBeenCalled();
    // Exatamente 30 MB ainda passa.
    const limite = { name: "a.jpg", type: "image/jpeg", size: MAX_BYTES_ENTRADA_FOTO } as File;
    await expect(converterParaJpeg(limite)).resolves.toBeDefined();
  });
});
