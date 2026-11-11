vi.mock("server-only", () => ({}));
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { criarSupabaseFalso } from "@/test/supabase-falso";

let falso = criarSupabaseFalso();
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => falso.cliente }));

import { POST } from "./route";

const SEGREDO = "segredo-do-webhook";

/**
 * Exemplo real do webhook "on-message-received" da Z-API (ReceivedCallback),
 * só com o telefone e ids trocados.
 */
const PAYLOAD_REAL = {
  isStatusReply: false,
  senderLid: "",
  connectedPhone: "5511999990000",
  waitingMessage: false,
  isEdit: false,
  isGroup: false,
  isNewsletter: false,
  instanceId: "ABC",
  messageId: "3EB0C767D0A1B2C3",
  phone: "5511988887777",
  fromMe: false,
  momment: 1736000000000,
  status: "RECEIVED",
  chatName: "Maria",
  senderName: "Maria",
  participantPhone: null,
  type: "ReceivedCallback",
  text: { message: "1" },
};

function requisicao(corpo: unknown, token: string | null = SEGREDO) {
  const url = new URL("http://localhost/api/webhooks/zapi");
  if (token !== null) url.searchParams.set("token", token);
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof corpo === "string" ? corpo : JSON.stringify(corpo),
  });
}

beforeEach(() => {
  falso = criarSupabaseFalso();
  falso.definirPadrao({ data: "d0000000-0000-4000-8000-0000000000d1", error: null });
  vi.stubEnv("ZAPI_WEBHOOK_TOKEN", SEGREDO);
});
afterEach(() => vi.unstubAllEnvs());

describe("POST /api/webhooks/zapi", () => {
  it("401 sem token, com token errado ou sem ZAPI_WEBHOOK_TOKEN", async () => {
    expect((await POST(requisicao(PAYLOAD_REAL, null))).status).toBe(401);
    expect((await POST(requisicao(PAYLOAD_REAL, "errado"))).status).toBe(401);
    vi.stubEnv("ZAPI_WEBHOOK_TOKEN", "");
    expect((await POST(requisicao(PAYLOAD_REAL, ""))).status).toBe(401);
    expect(falso.chamadasRpc("registrar_recebida")).toHaveLength(0);
  });

  it("401 com ZAPI_WEBHOOK_TOKEN ausente (não definida), com qualquer token", async () => {
    vi.stubEnv("ZAPI_WEBHOOK_TOKEN", undefined);
    expect(process.env.ZAPI_WEBHOOK_TOKEN).toBeUndefined();
    for (const token of [null, "", SEGREDO, "undefined"]) {
      expect((await POST(requisicao(PAYLOAD_REAL, token))).status).toBe(401);
    }
    expect(falso.chamadasRpc("registrar_recebida")).toHaveLength(0);
  });

  it("WhatsApp com 12 dígitos (sem o 9) vai como veio; o banco procura com e sem o 9", async () => {
    await POST(requisicao({ ...PAYLOAD_REAL, phone: "551188887777" }));
    expect(falso.chamadasRpc("registrar_recebida")[0].args[0]).toMatchObject({
      p_telefone: "551188887777",
    });
  });

  it("messageId com mais de 200 caracteres → ignorada; telefone fora do padrão cortado em 40", async () => {
    const r = await POST(requisicao({ ...PAYLOAD_REAL, messageId: "x".repeat(201) }));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ignorada: true });
    expect(falso.chamadasRpc("registrar_recebida")).toHaveLength(0);

    await POST(requisicao({ ...PAYLOAD_REAL, messageId: "x".repeat(200) }));
    await POST(requisicao({ ...PAYLOAD_REAL, messageId: "ID-2", phone: "a".repeat(100) }));
    const args = falso.chamadasRpc("registrar_recebida").map((c) => c.args[0]);
    expect(args[0]).toMatchObject({ p_id_externo: "x".repeat(200) });
    expect(args[1]).toMatchObject({ p_telefone: "a".repeat(40) });
  });

  it("payload real de exemplo → registrar_recebida com telefone, texto e messageId", async () => {
    const r = await POST(requisicao(PAYLOAD_REAL));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ registrada: true });
    expect(falso.chamadasRpc("registrar_recebida").map((c) => c.args[0])).toEqual([
      { p_telefone: "5511988887777", p_texto: "1", p_id_externo: "3EB0C767D0A1B2C3" },
    ]);
  });

  it("normaliza o telefone", async () => {
    await POST(requisicao({ ...PAYLOAD_REAL, phone: "+55 (11) 98888-7777" }));
    expect(falso.chamadasRpc("registrar_recebida")[0].args[0]).toMatchObject({
      p_telefone: "5511988887777",
    });
  });

  it("ignora fromMe, grupo e canal", async () => {
    for (const extra of [{ fromMe: true }, { isGroup: true }, { isNewsletter: true }]) {
      const r = await POST(requisicao({ ...PAYLOAD_REAL, ...extra }));
      expect(r.status).toBe(200);
      expect(await r.json()).toEqual({ ignorada: true });
    }
    expect(falso.chamadasRpc("registrar_recebida")).toHaveLength(0);
  });

  it("ignora corpo inválido, sem texto, sem messageId ou sem telefone", async () => {
    const corpos: unknown[] = [
      "não é json",
      null,
      [],
      { ...PAYLOAD_REAL, text: undefined },
      { ...PAYLOAD_REAL, text: { message: "" } },
      { ...PAYLOAD_REAL, text: { message: 1 } },
      { ...PAYLOAD_REAL, messageId: undefined },
      { ...PAYLOAD_REAL, messageId: " " },
      { ...PAYLOAD_REAL, phone: undefined },
    ];
    for (const corpo of corpos) {
      const r = await POST(requisicao(corpo));
      expect(r.status).toBe(200);
      expect(await r.json()).toEqual({ ignorada: true });
    }
    expect(falso.chamadasRpc("registrar_recebida")).toHaveLength(0);
  });

  it("erro do banco → 500 (a Z-API tenta de novo; o id externo evita duplicar)", async () => {
    const erro = vi.spyOn(console, "error").mockImplementation(() => {});
    falso.responder("rpc:registrar_recebida", { data: null, error: { message: "boom" } });
    const r = await POST(requisicao(PAYLOAD_REAL));
    expect(r.status).toBe(500);
    erro.mockRestore();
  });
});
