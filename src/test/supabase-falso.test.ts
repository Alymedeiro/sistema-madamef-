import { describe, expect, it } from "vitest";
import { criarSupabaseFalso } from "./supabase-falso";

describe("supabase falso: storage", () => {
  it("registra chamadas e usa a fila por método", async () => {
    const f = criarSupabaseFalso();
    const b = f.cliente.storage.from("ficha-clinica");
    expect(await b.upload("a.png", new Uint8Array(), { contentType: "image/png" })).toEqual({
      data: { path: "a.png" },
      error: null,
    });
    expect((await b.createSignedUrl("a.png", 300)).data).toEqual({ signedUrl: "https://assinada/a.png" });
    f.responder("storage:ficha-clinica:remove", { data: null, error: { message: "x" } });
    expect((await b.remove(["a.png"])).error).toEqual({ message: "x" });
    expect(f.chamadasDe("storage:ficha-clinica").map((c) => c.metodo)).toEqual([
      "upload",
      "createSignedUrl",
      "remove",
    ]);
  });
});
