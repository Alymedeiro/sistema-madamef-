import { describe, expect, it } from "vitest";
import { avaliarGuarda, refDoProjeto } from "./guarda";

const base = {
  url: "https://abcdefghij.supabase.co",
  anon: "a",
  service: "s",
  permitirProjeto: "abcdefghij",
};

describe("refDoProjeto", () => {
  it("lê o ref, reconhece stack local e rejeita o resto", () => {
    expect(refDoProjeto("https://abcdefghij.supabase.co")).toBe("abcdefghij");
    expect(refDoProjeto("http://127.0.0.1:54321")).toBe("local");
    expect(refDoProjeto("http://localhost:54321")).toBe("local");
    expect(refDoProjeto("http://abcdefghij.supabase.co")).toBeNull();
    expect(refDoProjeto("https://abcdefghij.supabase.co.evil.com")).toBeNull();
    expect(refDoProjeto("https://example.com")).toBeNull();
    expect(refDoProjeto("lixo")).toBeNull();
  });
});

describe("avaliarGuarda", () => {
  it("permite quando o ref autorizado confere", () => {
    expect(avaliarGuarda(base)).toEqual({ permitido: true });
    expect(
      avaliarGuarda({ ...base, url: "http://127.0.0.1:54321", permitirProjeto: "local" }),
    ).toEqual({ permitido: true });
  });
  it("bloqueia sem variáveis, sem autorização ou com ref diferente", () => {
    expect(avaliarGuarda({}).permitido).toBe(false);
    expect(avaliarGuarda({ ...base, service: undefined }).permitido).toBe(false);
    expect(avaliarGuarda({ ...base, permitirProjeto: undefined })).toMatchObject({
      permitido: false,
      motivo: expect.stringContaining("E2E_PERMITIR_PROJETO=abcdefghij"),
    });
    expect(avaliarGuarda({ ...base, permitirProjeto: "outroprojeto" }).permitido).toBe(false);
  });
  it("bloqueia URL desconhecida mesmo com autorização", () => {
    expect(
      avaliarGuarda({ ...base, url: "https://example.com", permitirProjeto: "example.com" }).permitido,
    ).toBe(false);
  });
  it("com E2E_BASE_URL exige a permissão idêntica", () => {
    const b = { ...base, baseUrl: "https://sistema.exemplo.com" };
    expect(avaliarGuarda(b).permitido).toBe(false);
    expect(avaliarGuarda({ ...b, baseUrlPermitida: "https://outro.com" }).permitido).toBe(false);
    expect(avaliarGuarda({ ...b, baseUrlPermitida: b.baseUrl }).permitido).toBe(true);
  });
});
