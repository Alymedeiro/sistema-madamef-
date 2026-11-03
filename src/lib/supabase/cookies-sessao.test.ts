import { describe, expect, it } from "vitest";
import { cookiesComJanelaDeInatividade } from "./cookies-sessao";

describe("cookiesComJanelaDeInatividade", () => {
  it("reemite cookies sb-* existentes com validade de 12 h", () => {
    const r = cookiesComJanelaDeInatividade(
      [
        { name: "sb-abc-auth-token", value: "tok" },
        { name: "outro", value: "x" },
      ],
      [],
    );
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({
      name: "sb-abc-auth-token",
      value: "tok",
      options: { maxAge: 43200, path: "/" },
    });
  });

  it("cookies recém-gravados (refresh) substituem os da requisição", () => {
    const r = cookiesComJanelaDeInatividade(
      [{ name: "sb-abc-auth-token", value: "velho" }],
      [
        {
          name: "sb-abc-auth-token",
          value: "novo",
          options: { path: "/", maxAge: 34560000 },
        },
      ],
    );
    expect(r).toHaveLength(1);
    expect(r[0].value).toBe("novo");
    expect(r[0].options.maxAge).toBe(43200);
  });

  it("não ressuscita cookies que o Supabase removeu", () => {
    const r = cookiesComJanelaDeInatividade(
      [{ name: "sb-abc-auth-token", value: "tok" }],
      [{ name: "sb-abc-auth-token", value: "", options: { maxAge: 0, path: "/" } }],
    );
    expect(r).toHaveLength(1);
    expect(r[0].options.maxAge).toBe(0);
  });
});
