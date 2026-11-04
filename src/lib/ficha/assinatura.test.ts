import { describe, expect, it } from "vitest";
import { decodificarAssinaturaPng } from "./assinatura";

const png = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0,
]);

describe("decodificarAssinaturaPng", () => {
  it("aceita PNG válido", () => {
    expect(
      decodificarAssinaturaPng(
        `data:image/png;base64,${png.toString("base64")}`,
      ),
    ).toEqual(new Uint8Array(png));
  });
  it("recusa outro tipo, conteúdo que não é PNG, base64 inválido e arquivo grande", () => {
    expect(
      decodificarAssinaturaPng(
        `data:image/jpeg;base64,${png.toString("base64")}`,
      ),
    ).toBeNull();
    expect(
      decodificarAssinaturaPng("data:image/png;base64,bm90LXBuZw=="),
    ).toBeNull();
    expect(decodificarAssinaturaPng("data:image/png;base64,@@@")).toBeNull();
    expect(
      decodificarAssinaturaPng(
        `data:image/png;base64,${Buffer.concat([png, Buffer.alloc(200 * 1024)]).toString("base64")}`,
      ),
    ).toBeNull();
  });
});
