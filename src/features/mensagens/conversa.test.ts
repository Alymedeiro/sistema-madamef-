import { describe, expect, it, vi } from "vitest";
import {
  avisoMidia,
  cancelarDoBalao,
  enviarResposta,
  estaPertoDoFim,
  formatarTamanho,
  inserirNoCursor,
  reaproveitarUrlsMidia,
  reenviarDoBalao,
  rotuloAgendada,
  rotuloDia,
  rotuloHorarioConversa,
  textoEnviavel,
  urlBaixar,
} from "./conversa";

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
    expect(await enviarResposta(base, { enviar, marcarLida })).toEqual({ ok: true, lida: true });
    expect(enviar).toHaveBeenCalledWith({ clienteId: "c1", texto: "Oi" });
    expect(marcarLida).toHaveBeenCalledWith("r1");
  });

  it("falha ao marcar lida devolve lida: false (tenta de novo no próximo envio)", async () => {
    const r = await enviarResposta(base, {
      enviar: async () => ({ ok: true }),
      marcarLida: async () => ({ ok: false, erro: "x" }),
    });
    expect(r).toEqual({ ok: true, lida: false });
  });

  it("estaPertoDoFim respeita a margem de 80 px", () => {
    expect(estaPertoDoFim({ scrollTop: 520, scrollHeight: 1000, clientHeight: 400 })).toBe(true);
    expect(estaPertoDoFim({ scrollTop: 400, scrollHeight: 1000, clientHeight: 400 })).toBe(false);
  });

  it("não marca de novo se já estava lida", async () => {
    const marcarLida = vi.fn();
    await enviarResposta(
      { ...base, jaLida: true },
      { enviar: async () => ({ ok: true }), marcarLida },
    );
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

describe("rotuloHorarioConversa", () => {
  const agora = new Date("2026-11-12T15:00:00Z"); // 12:00 em São Paulo
  it("hoje mostra HH:mm", () => {
    expect(rotuloHorarioConversa("2026-11-12T13:30:00Z", agora)).toBe("10:30");
  });
  it("ontem e datas antigas", () => {
    expect(rotuloHorarioConversa("2026-11-11T20:00:00Z", agora)).toBe("Ontem");
    expect(rotuloHorarioConversa("2026-11-05T20:00:00Z", agora)).toBe("05/11");
  });
  it("a virada do dia é em São Paulo, não em UTC", () => {
    const tarde = new Date("2026-11-13T01:00:00Z"); // 22:00 de 12/11 em SP
    expect(rotuloHorarioConversa("2026-11-13T00:30:00Z", tarde)).toBe("21:30");
    expect(rotuloHorarioConversa("2026-11-12T02:00:00Z", tarde)).toBe("Ontem"); // 23:00 de 11/11
  });
});

describe("ações do balão", () => {
  it("Cancelar chama cancelarMensagem com o id e o motivo da equipe", async () => {
    const cancelar = vi.fn(async () => ({ ok: true as const }));
    const r = await cancelarDoBalao("m1", { cancelar });
    expect(cancelar).toHaveBeenCalledWith({ id: "m1", motivo: "Cancelada pela equipe" });
    expect(r).toEqual({ ok: true });
  });

  it("Tentar de novo chama reenviarMensagem com o id e repassa o erro", async () => {
    const reenviar = vi.fn(async () => ({ ok: false as const, erro: "Sem WhatsApp." }));
    expect(await reenviarDoBalao("m2", { reenviar })).toEqual({ ok: false, erro: "Sem WhatsApp." });
    expect(reenviar).toHaveBeenCalledWith("m2");
  });
});

describe("rotuloAgendada", () => {
  const agora = new Date("2026-11-10T12:00:00Z");
  it("pendente no futuro mostra a data e a hora de São Paulo", () => {
    expect(rotuloAgendada({ status: "pendente", quando: "2026-11-12T17:30:00Z" }, agora)).toBe(
      "Agendada para 12/11 14:30",
    );
  });
  it("já vencida, enviada ou de outro status não é agendada", () => {
    expect(rotuloAgendada({ status: "pendente", quando: "2026-11-10T11:00:00Z" }, agora)).toBeNull();
    expect(rotuloAgendada({ status: "enviada", quando: "2026-11-12T17:30:00Z" }, agora)).toBeNull();
    expect(rotuloAgendada({ quando: "2026-11-12T17:30:00Z" }, agora)).toBeNull();
  });
});

describe("mídia no balão", () => {
  it("formatarTamanho", () => {
    expect(formatarTamanho(null)).toBeNull();
    expect(formatarTamanho(850)).toBe("850 B");
    expect(formatarTamanho(12 * 1024)).toBe("12 KB");
    expect(formatarTamanho(1.25 * 1024 * 1024)).toBe("1,3 MB");
  });

  it("avisoMidia por status", () => {
    expect(avisoMidia({ status: "pendente", url: null })).toBe("Carregando mídia…");
    expect(avisoMidia({ status: "falhou", url: null })).toBe("Não foi possível baixar a mídia");
    expect(avisoMidia({ status: "grande_demais", url: null })).toBe(
      "Arquivo grande demais — veja no celular",
    );
    expect(avisoMidia({ status: "salva", url: null })).toBe("Mídia indisponível no momento");
    expect(avisoMidia({ status: "salva", url: "https://x" })).toBeNull();
  });

  it("urlBaixar acrescenta download com o nome", () => {
    expect(urlBaixar("https://s/x?token=a", "Exame 1.pdf")).toBe(
      "https://s/x?token=a&download=Exame%201.pdf",
    );
    expect(urlBaixar("https://s/x", null)).toBe("https://s/x?download=");
  });

  it("reaproveitarUrlsMidia mantém a URL por 8 min e depois troca", () => {
    const cache = new Map<string, { url: string; em: number }>();
    const item = (url: string | null) => ({ id: "r1", midia: { url } });
    expect(reaproveitarUrlsMidia([item("u1")], cache, 0)[0].midia.url).toBe("u1");
    expect(reaproveitarUrlsMidia([item("u2")], cache, 7 * 60_000)[0].midia.url).toBe("u1");
    expect(reaproveitarUrlsMidia([item("u3")], cache, 8 * 60_000)[0].midia.url).toBe("u3");
    expect(reaproveitarUrlsMidia([item(null)], cache, 9 * 60_000)[0].midia.url).toBeNull();
    const semMidia = { id: "x" };
    expect(reaproveitarUrlsMidia([semMidia], cache)[0]).toBe(semMidia);
  });
});
