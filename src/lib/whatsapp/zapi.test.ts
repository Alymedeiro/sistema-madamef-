vi.mock("server-only", () => ({}));
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { credenciaisOmni, credenciaisZapi, enviarTexto, statusConexao, temChavesWhatsapp } from "./zapi";

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
  it("2xx sem id (nem messageId, zaapId ou id) vira erro", async () => {
    for (const corpo of [{}, { messageId: "" }, { messageId: 1, zaapId: null }]) {
      const f = vi.fn().mockResolvedValue(resposta(corpo));
      expect(await enviarTexto("5511999999999", "Oi", f)).toEqual({
        ok: false,
        erro: "Z-API não devolveu id da mensagem",
        desconectado: false,
      });
    }
    const vazio = vi.fn().mockResolvedValue(new Response("", { status: 200 }));
    expect(await enviarTexto("5511999999999", "Oi", vazio)).toMatchObject({
      ok: false,
      erro: "Z-API não devolveu id da mensagem",
    });
  });
  it("erro com corpo não-JSON usa o texto bruto (até 200 caracteres)", async () => {
    const f = vi
      .fn()
      .mockResolvedValue(new Response("<html>Bad Gateway</html>", { status: 502 }));
    expect(await enviarTexto("5511999999999", "Oi", f)).toEqual({
      ok: false,
      erro: "Z-API 502: <html>Bad Gateway</html>",
      desconectado: false,
    });
    const longo = vi.fn().mockResolvedValue(new Response("x".repeat(500), { status: 500 }));
    const r = await enviarTexto("5511999999999", "Oi", longo);
    expect(r.ok === false && r.erro).toBe(`Z-API 500: ${"x".repeat(200)}`);
    const semCorpo = vi.fn().mockResolvedValue(new Response("", { status: 503 }));
    expect(await enviarTexto("5511999999999", "Oi", semCorpo)).toMatchObject({
      ok: false,
      erro: "Z-API 503",
    });
    const desconectado = vi
      .fn()
      .mockResolvedValue(new Response("instance not connected", { status: 400 }));
    expect(await enviarTexto("5511999999999", "Oi", desconectado)).toMatchObject({
      desconectado: true,
    });
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

describe("Z-API Omni (OMNI_SECRET_KEY + OMNI_CHANNEL_ID)", () => {
  beforeEach(() => {
    vi.stubEnv("OMNI_SECRET_KEY", "SECRET");
    vi.stubEnv("OMNI_CHANNEL_ID", "CANAL1");
  });

  it("envia texto pela Omni com Bearer e o corpo exato", async () => {
    const f = vi.fn().mockResolvedValue(resposta({ messageId: "01A0C92D0C957FE98B73C8BA0CACF741" }));
    const r = await enviarTexto("5511999999999", "Oi", f);
    expect(r).toEqual({ ok: true, idExterno: "01A0C92D0C957FE98B73C8BA0CACF741" });
    const [url, init] = f.mock.calls[0];
    expect(url).toBe("https://api.omni.z-api.io/v1/channels/CANAL1/messages");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer SECRET");
    expect(JSON.parse(init.body)).toEqual({
      recipient: { identifier: "5511999999999" },
      content: { type: "TEXT", body: { message: "Oi" } },
    });
  });

  it("422 CHANNEL_DISCONNECTED → desconectado", async () => {
    const f = vi.fn().mockResolvedValue(
      resposta({ code: "BUSINESS_RULE_VIOLATION", subCode: "CHANNEL_DISCONNECTED", message: "Channel is disconnected" }, 422),
    );
    const r = await enviarTexto("5511999999999", "Oi", f);
    expect(r).toEqual({ ok: false, erro: "Omni 422: CHANNEL_DISCONNECTED", desconectado: true });
  });

  it("outro erro não é desconexão", async () => {
    const f = vi.fn().mockResolvedValue(resposta({ code: "VALIDATION_ERROR", message: "Field 'x'" }, 400));
    const r = await enviarTexto("5511999999999", "Oi", f);
    expect(r).toEqual({ ok: false, erro: "Omni 400: Field 'x'", desconectado: false });
  });

  it("2xx sem messageId vira erro", async () => {
    const f = vi.fn().mockResolvedValue(resposta({}));
    expect(await enviarTexto("5511999999999", "Oi", f)).toEqual({
      ok: false,
      erro: "Omni não devolveu id da mensagem",
      desconectado: false,
    });
  });

  it("status pelo endpoint do QR Code (connected)", async () => {
    const f = vi.fn().mockResolvedValue(resposta({ connected: true, qrcode: null }));
    expect(await statusConexao(f)).toBe("conectado");
    const [url, init] = f.mock.calls[0];
    expect(url).toBe("https://api.omni.z-api.io/v1/channels/CANAL1/zapi/qr-code/image");
    expect(init.headers.Authorization).toBe("Bearer SECRET");
    const g = vi.fn().mockResolvedValue(resposta({ connected: false, qrcode: "data:..." }));
    expect(await statusConexao(g)).toBe("desconectado");
  });

  it("Omni tem prioridade sobre a Z-API tradicional; sem nenhuma → temChavesWhatsapp false", async () => {
    expect(temChavesWhatsapp()).toBe(true);
    vi.unstubAllEnvs();
    expect(temChavesWhatsapp()).toBe(false);
    expect(credenciaisOmni()).toBeNull();
  });
});
