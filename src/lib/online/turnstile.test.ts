import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { verificarTurnstile } from "./turnstile";

describe("verificarTurnstile", () => {
  beforeEach(() => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", "segredo");
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("success true -> true, enviando segredo, token e ip", async () => {
    const f = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true }) });
    vi.stubGlobal("fetch", f);
    expect(await verificarTurnstile("tok", "1.2.3.4")).toBe(true);
    expect(f.mock.calls[0][0]).toBe("https://challenges.cloudflare.com/turnstile/v0/siteverify");
    const corpo = new URLSearchParams(String(f.mock.calls[0][1].body));
    expect(corpo.get("secret")).toBe("segredo");
    expect(corpo.get("response")).toBe("tok");
    expect(corpo.get("remoteip")).toBe("1.2.3.4");
  });

  it("success false -> false", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: false }) }));
    expect(await verificarTurnstile("tok", null)).toBe(false);
  });

  it("falha de rede -> false", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("rede")));
    expect(await verificarTurnstile("tok", null)).toBe(false);
  });

  it("resposta HTTP de erro -> false", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => ({ success: true }) }));
    expect(await verificarTurnstile("tok", null)).toBe(false);
  });

  it("sem segredo -> true com aviso, sem chamar a rede", async () => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", "");
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    expect(await verificarTurnstile("tok", null)).toBe(true);
    expect(f).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalled();
  });
});
