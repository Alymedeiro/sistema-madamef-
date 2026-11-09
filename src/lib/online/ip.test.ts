import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { ipHash } from "./ip";

const h = (v: Record<string, string>) => new Headers(v);

describe("ipHash", () => {
  beforeEach(() => vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "chave-de-teste"));
  afterEach(() => vi.unstubAllEnvs());

  it("igual para o mesmo IP e diferente para IPs diferentes", () => {
    const a = ipHash(h({ "x-forwarded-for": "1.2.3.4" }));
    expect(a).toBe(ipHash(h({ "x-forwarded-for": "1.2.3.4" })));
    expect(a).not.toBe(ipHash(h({ "x-forwarded-for": "1.2.3.5" })));
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("usa o primeiro item de x-forwarded-for", () => {
    expect(ipHash(h({ "x-forwarded-for": "1.2.3.4, 9.9.9.9" }))).toBe(
      ipHash(h({ "x-forwarded-for": "1.2.3.4" })),
    );
  });

  it("não contém o IP", () => {
    expect(ipHash(h({ "x-forwarded-for": "1.2.3.4" }))).not.toContain("1.2.3.4");
  });

  it("sem IP vira o hash de 'desconhecido'", () => {
    expect(ipHash(h({}))).toBe(ipHash(h({ "x-forwarded-for": "desconhecido" })));
  });

  it("a chave muda o hash", () => {
    const a = ipHash(h({ "x-forwarded-for": "1.2.3.4" }));
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "outra");
    expect(ipHash(h({ "x-forwarded-for": "1.2.3.4" }))).not.toBe(a);
  });
});
