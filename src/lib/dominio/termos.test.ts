import { describe, expect, it } from "vitest";
import { blocosMarkdown, resumirUserAgent } from "./termos";

describe("blocosMarkdown", () => {
  it("separa título, parágrafo e itens", () => {
    expect(
      blocosMarkdown("# Riscos\nPode haver\nvermelhidão.\n\n- Evitar sol\n- Usar protetor"),
    ).toEqual([
      { tipo: "titulo", texto: "Riscos" },
      { tipo: "paragrafo", texto: "Pode haver vermelhidão." },
      { tipo: "item", texto: "Evitar sol" },
      { tipo: "item", texto: "Usar protetor" },
    ]);
  });

  it("linha vazia separa parágrafos; outras marcações ficam como texto", () => {
    expect(blocosMarkdown("Um\n\n**Dois** e #três\r\nseguem\n\n\n")).toEqual([
      { tipo: "paragrafo", texto: "Um" },
      { tipo: "paragrafo", texto: "**Dois** e #três seguem" },
    ]);
    expect(blocosMarkdown("")).toEqual([]);
  });
});

describe("resumirUserAgent", () => {
  const ua = (s: string) => resumirUserAgent(s);
  it("reconhece aparelhos e navegadores comuns", () => {
    expect(
      ua(
        "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
      ),
    ).toBe("iPad · Safari");
    expect(
      ua(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
      ),
    ).toBe("iPhone · Safari");
    expect(
      ua(
        "Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      ),
    ).toBe("Android · Chrome");
    expect(
      ua(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0",
      ),
    ).toBe("Windows · Edge");
    expect(
      ua(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      ),
    ).toBe("Mac · Chrome");
  });

  it("desconhecido: primeiros 60 caracteres; nunca passa de 200", () => {
    expect(ua("curl/8.0")).toBe("curl/8.0");
    expect(ua("x".repeat(500))).toBe("x".repeat(60));
    expect(resumirUserAgent("x".repeat(500)).length).toBeLessThanOrEqual(200);
    expect(ua("")).toBe("");
  });
});
