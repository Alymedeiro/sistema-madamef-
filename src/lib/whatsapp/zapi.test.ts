vi.mock("server-only", () => ({}));
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { credenciaisZapi, enviarTexto, statusConexao } from "./zapi";

const resposta = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status });

beforeEach(() => {
  vi.stubEnv("ZAPI_INSTANCE_ID", "INST");
  vi.stubEnv("ZAPI_TOKEN", "TOK");
  vi.stubEnv("ZAPI_CLIENT_TOKEN", "CLI");
});
afterEach(() => vi.unstubAllEnvs());

describe("enviarTexto", () => {
  it("envia com URL e headers exatos e devolve o messageId", async () => {
    const f = vi.fn().mockResolvedValue(resposta({ zaapId: "z1", messageId: "m1", id: "i1" }));
    const r = await enviarTexto("5511999999999", "Oi", f);
    expect(r).toEqual({ ok: true, idExterno: "m1" });
    const [url, init] = f.mock.calls[0];
    expect(url).toBe("https://api.z-api.io/instances/INST/token/TOK/send-text");
    expect(init.method).toBe("POST");
    expect(init.headers["Client-Token"]).toBe("CLI");
    expect(JSON.parse(init.body)).toEqual({ phone: "5511999999999", message: "Oi" });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
  it("usa zaapId quando falta messageId", async () => {
    const f = vi.fn().mockResolvedValue(resposta({ zaapId: "z1" }));
    expect(await enviarTexto("5511999999999", "Oi", f)).toEqual({ ok: true, idExterno: "z1" });
  });
  it("400 vira erro sem desconectado", async () => {
    const f = vi.fn().mockResolvedValue(resposta({ error: "invalid phone" }, 400));
    const r = await enviarTexto("5511999999999", "Oi", f);
    expect(r).toMatchObject({ ok: false, desconectado: false });
    expect(r.ok === false && r.erro).toContain("400");
  });
  it("timeout vira Tempo esgotado", async () => {
    const f = vi.fn().mockRejectedValue(new DOMException("t", "TimeoutError"));
    expect(await enviarTexto("5511999999999", "Oi", f)).toEqual({
      ok: false,
      erro: "Tempo esgotado",
      desconectado: false,
    });
  });
  it("instância desconectada", async () => {
    const f = vi
      .fn()
      .mockResolvedValue(resposta({ error: "You are not connected." }, 400));
    expect(await enviarTexto("5511999999999", "Oi", f)).toMatchObject({
      ok: false,
      desconectado: true,
    });
    const g = vi.fn().mockResolvedValue(resposta({ error: "Instance disconnected" }, 500));
    expect(await enviarTexto("5511999999999", "Oi", g)).toMatchObject({ desconectado: true });
  });
  it("sem chaves não chama fetch", async () => {
    vi.stubEnv("ZAPI_TOKEN", "");
    const f = vi.fn();
    const r = await enviarTexto("5511999999999", "Oi", f);
    expect(r.ok).toBe(false);
    expect(f).not.toHaveBeenCalled();
    expect(credenciaisZapi()).toBeNull();
  });
});

describe("statusConexao", () => {
  it("conectado, desconectado e sem_chaves", async () => {
    const ok = vi.fn().mockResolvedValue(resposta({ connected: true }));
    expect(await statusConexao(ok)).toBe("conectado");
    expect(ok.mock.calls[0][0]).toBe("https://api.z-api.io/instances/INST/token/TOK/status");
    expect(ok.mock.calls[0][1].headers["Client-Token"]).toBe("CLI");
    const off = vi.fn().mockResolvedValue(resposta({ connected: false, error: "x" }));
    expect(await statusConexao(off)).toBe("desconectado");
    vi.stubEnv("ZAPI_CLIENT_TOKEN", "");
    const nunca = vi.fn();
    expect(await statusConexao(nunca)).toBe("sem_chaves");
    expect(nunca).not.toHaveBeenCalled();
  });
});
