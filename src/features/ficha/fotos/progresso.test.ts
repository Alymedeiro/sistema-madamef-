import { describe, expect, it, vi } from "vitest";
import { comProgresso } from "./progresso";

describe("comProgresso", () => {
  it("limpa o progresso ao terminar", async () => {
    const definir = vi.fn();
    await comProgresso(definir, async () => {
      definir("Enviando…");
    });
    expect(definir.mock.calls.at(-1)).toEqual([null]);
  });

  it("limpa o progresso mesmo quando a ação lança (tela não fica travada)", async () => {
    const definir = vi.fn();
    await expect(
      comProgresso(definir, async () => {
        definir("Salvando…");
        throw new Error("rede caiu");
      }),
    ).rejects.toThrow("rede caiu");
    expect(definir.mock.calls.at(-1)).toEqual([null]);
  });
});
