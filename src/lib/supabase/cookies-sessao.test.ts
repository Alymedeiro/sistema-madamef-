import { describe, expect, it } from "vitest";
import {
  COOKIE_ATIVIDADE,
  cookieDeAtividade,
  cookiesDaResposta,
  sessaoExpiradaPorInatividade,
} from "./cookies-sessao";

const tokens = [
  { name: "sb-abc-auth-token.0", value: "a" },
  { name: "sb-abc-auth-token.1", value: "b" },
];

describe("sessaoExpiradaPorInatividade", () => {
  it("tokens sem cookie de atividade = expirada", () => {
    expect(sessaoExpiradaPorInatividade(tokens)).toBe(true);
  });
  it("tokens com cookie de atividade = ativa", () => {
    expect(
      sessaoExpiradaPorInatividade([
        ...tokens,
        { name: COOKIE_ATIVIDADE, value: "1" },
      ]),
    ).toBe(false);
  });
  it("sem tokens não há o que expirar", () => {
    expect(sessaoExpiradaPorInatividade([])).toBe(false);
    expect(sessaoExpiradaPorInatividade([{ name: "x", value: "1" }])).toBe(false);
  });
});

describe("cookieDeAtividade", () => {
  it("dura 12 h, httpOnly, para o site todo", () => {
    const c = cookieDeAtividade(1700000000000, true);
    expect(c.name).toBe("ultima_atividade");
    expect(c.value).toBe("1700000000000");
    expect(c.options).toMatchObject({
      maxAge: 43200,
      httpOnly: true,
      path: "/",
      sameSite: "lax",
      secure: true,
    });
  });
});

describe("cookiesDaResposta", () => {
  const existentes = [...tokens, { name: COOKIE_ATIVIDADE, value: "1" }];

  it("não reescreve sb-* quando o Supabase não renovou; só renova a atividade", () => {
    const r = cookiesDaResposta({
      existentes,
      escritos: [],
      temSessao: true,
      expirada: false,
      agora: 5,
    });
    expect(r.map((c) => c.name)).toEqual([COOKIE_ATIVIDADE]);
    expect(r[0].value).toBe("5");
    expect(r[0].options.maxAge).toBe(43200);
    expect(r[0].options.httpOnly).toBe(true);
  });

  it("repassa o que o Supabase gravou num refresh, sem tocar nos demais sb-*", () => {
    const refresh = {
      name: "sb-abc-auth-token.0",
      value: "novo",
      options: { path: "/", maxAge: 34560000 },
    };
    const r = cookiesDaResposta({
      existentes,
      escritos: [refresh],
      temSessao: true,
      expirada: false,
    });
    expect(r).toHaveLength(2);
    expect(r[0]).toBe(refresh);
    expect(r[1].name).toBe(COOKIE_ATIVIDADE);
  });

  it("sem sessão não cria cookie de atividade", () => {
    const r = cookiesDaResposta({
      existentes: [],
      escritos: [],
      temSessao: false,
      expirada: false,
    });
    expect(r).toEqual([]);
  });

  it("expirada: remove todo sb-* da requisição e não renova a atividade", () => {
    const r = cookiesDaResposta({
      existentes: tokens,
      escritos: [],
      temSessao: false,
      expirada: true,
    });
    expect(r.map((c) => c.name).sort()).toEqual([
      "sb-abc-auth-token.0",
      "sb-abc-auth-token.1",
    ]);
    for (const c of r) {
      expect(c.value).toBe("");
      expect(c.options.maxAge).toBe(0);
    }
  });

  it("expirada: remoção prevalece sobre o que o signOut gravou", () => {
    const r = cookiesDaResposta({
      existentes: tokens,
      escritos: [
        { name: "sb-abc-auth-token.0", value: "qualquer", options: { maxAge: 100 } },
      ],
      temSessao: false,
      expirada: true,
    });
    const c0 = r.find((c) => c.name === "sb-abc-auth-token.0");
    expect(c0?.value).toBe("");
    expect(c0?.options.maxAge).toBe(0);
  });
});
