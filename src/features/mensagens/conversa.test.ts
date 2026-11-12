import { describe, expect, it, vi } from "vitest";
import { enviarResposta, inserirNoCursor, rotuloDia, textoEnviavel } from "./conversa";

describe("enviarResposta", () => {
  const base = { clienteId: "c1", texto: "Oi", respostaId: "r1", jaLida: false };
  it("texto em branco não chama a action", async () => {
    const enviar = vi.fn();
    const marcarLida = vi.fn();
    const r = await enviarResposta({ ...base, texto: "  \n" }, { enviar, marcarLida });
    expect(r.ok).toBe(false);
    expect(enviar).not.toHaveBeenCalled();
    expect(marcarLida).not.toHaveBeenCalled();
  });

  it("envia e marca a resposta como lida", async () => {
    const enviar = vi.fn(async () => ({ ok: true as const }));
    const marcarLida = vi.fn(async () => ({ ok: true as const }));
    expect(await enviarResposta(base, { enviar, marcarLida })).toEqual({ ok: true });
    expect(enviar).toHaveBeenCalledWith({ clienteId: "c1", texto: "Oi" });
    expect(marcarLida).toHaveBeenCalledWith("r1");
  });

  it("não marca de novo se já estava lida", async () => {
    const marcarLida = vi.fn();
    await enviarResposta({ ...base, jaLida: true }, { enviar: async () => ({ ok: true }), marcarLida });
    expect(marcarLida).not.toHaveBeenCalled();
  });

  it("erro do envio devolve a mensagem e não marca lida", async () => {
    const marcarLida = vi.fn();
    const r = await enviarResposta(base, {
      enviar: async () => ({ ok: false, erro: "Sem WhatsApp." }),
      marcarLida,
    });
    expect(r).toEqual({ ok: false, erro: "Sem WhatsApp." });
    expect(marcarLida).not.toHaveBeenCalled();
  });
});

describe("inserirNoCursor", () => {
  it("insere no início, no meio e no fim", () => {
    expect(inserirNoCursor("Oi", 0, 0, "😊")).toEqual({ texto: "😊Oi", cursor: 2 });
    expect(inserirNoCursor("Oi Ana", 2, 2, "💅")).toEqual({ texto: "Oi💅 Ana", cursor: 4 });
    expect(inserirNoCursor("Oi", 2, 2, "🌸")).toEqual({ texto: "Oi🌸", cursor: 4 });
  });

  it("substitui a seleção", () => {
    expect(inserirNoCursor("Oi Ana", 3, 6, "✨")).toEqual({ texto: "Oi ✨", cursor: 4 });
  });

  it("emoji com ZWJ conta o comprimento UTF-16 inteiro", () => {
    const e = "💆‍♀️";
    const r = inserirNoCursor("a", 1, 1, e);
    expect(r.cursor).toBe(1 + e.length);
    expect(r.texto).toBe("a" + e);
  });

  it("limita os índices ao texto", () => {
    expect(inserirNoCursor("Oi", 10, 20, "x")).toEqual({ texto: "Oix", cursor: 3 });
  });
});

describe("rotuloDia", () => {
  const agora = new Date("2026-11-12T15:00:00Z"); // 12:00 em SP
  it("Hoje, Ontem e data", () => {
    expect(rotuloDia("2026-11-12T13:00:00Z", agora)).toBe("Hoje");
    expect(rotuloDia("2026-11-11T20:00:00Z", agora)).toBe("Ontem");
    expect(rotuloDia("2026-11-10T20:00:00Z", agora)).toBe("10/11/2026");
  });

  it("respeita a virada do dia em São Paulo", () => {
    // 02:30Z do dia 13 ainda é 23:30 do dia 12 em SP
    const noite = new Date("2026-11-13T02:30:00Z");
    expect(rotuloDia("2026-11-13T02:00:00Z", noite)).toBe("Hoje");
    expect(rotuloDia("2026-11-12T02:59:00Z", noite)).toBe("Ontem"); // 23:59 do dia 11
    // 03:10Z já é dia 13 em SP
    const depois = new Date("2026-11-13T03:10:00Z");
    expect(rotuloDia("2026-11-13T02:00:00Z", depois)).toBe("Ontem");
  });
});

describe("textoEnviavel", () => {
  it("só espaços não envia", () => {
    expect(textoEnviavel("   \n ")).toBe(false);
    expect(textoEnviavel("")).toBe(false);
    expect(textoEnviavel(" Oi ")).toBe(true);
  });
});
