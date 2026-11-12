vi.mock("server-only", () => ({}));
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { criarSupabaseFalso } from "@/test/supabase-falso";

let falso = criarSupabaseFalso();
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => falso.cliente }));

/** Tarefas de after() (rodam depois da resposta; o teste as executa). */
let depois: (() => unknown)[] = [];
vi.mock("next/server", () => ({ after: (fn: () => unknown) => void depois.push(fn) }));
const rodarDepois = async () => {
  const tarefas = depois;
  depois = [];
  for (const t of tarefas) await t();
};

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
  depois = [];
  falso = criarSupabaseFalso();
  falso.definirPadrao({ data: "d0000000-0000-4000-8000-0000000000d1", error: null });
  vi.stubEnv("ZAPI_WEBHOOK_TOKEN", SEGREDO);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

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

/** Formato DEFAULT do webhook de canal da Z-API Omni (mensagem recebida). */
const PAYLOAD_OMNI = {
  message: {
    _id: "019E6F1A93FE78DCB54332F9FF0CCAE7",
    channel_id: "019E4C54B1B375A28970B605CA9B03C3",
    created: 1779980473342,
    metadata: { "@class": ".Metadata", from_api: false, from_me: false, middleware: "Z_API_WHATSAPP" },
    sender: { "@class": ".Sender", identifier: "5511988887777", name: "Maria" },
    recipient: { "@class": ".Recipient", identifier: "5511999990000" },
    contents: [{ "@class": ".TextContent", message: " 1 ", type: "TEXT" }],
    attachments: [],
  },
  messageEventType: "NEW_MESSAGE",
};

describe("POST /api/webhooks/zapi — formato Omni (DEFAULT)", () => {
  it("mensagem recebida → registrar_recebida com sender, texto e _id", async () => {
    const r = await POST(requisicao(PAYLOAD_OMNI));
    expect(await r.json()).toEqual({ registrada: true });
    expect(falso.chamadasRpc("registrar_recebida").map((c) => c.args[0])).toEqual([
      { p_telefone: "5511988887777", p_texto: " 1 ", p_id_externo: "019E6F1A93FE78DCB54332F9FF0CCAE7" },
    ]);
  });

  it("ignora enviada pelo negócio, de grupo, sem texto e callback de status", async () => {
    const m = PAYLOAD_OMNI.message;
    const casos = [
      { ...PAYLOAD_OMNI, message: { ...m, metadata: { ...m.metadata, from_me: true } } },
      {
        ...PAYLOAD_OMNI,
        message: {
          ...m,
          contents: [{ type: "TEXT", message: "oi", internal_information: { group_id: "120363-group" } }],
        },
      },
      { ...PAYLOAD_OMNI, message: { ...m, contents: [] } },
      {
        ...PAYLOAD_OMNI,
        message: { ...m, contents: [{ type: "MessageStatusCallback", phone: "5511988887777" }] },
      },
    ];
    for (const c of casos) expect(await (await POST(requisicao(c))).json()).toEqual({ ignorada: true });
    expect(falso.chamadasRpc("registrar_recebida")).toHaveLength(0);
  });

  it("continua exigindo o token", async () => {
    expect((await POST(requisicao(PAYLOAD_OMNI, "errado"))).status).toBe(401);
  });
});

const ID_RECEBIDA = "d0000000-0000-4000-8000-0000000000d1";

/** Imagem recebida, formato DEFAULT do Omni (exemplo da documentação, from_me: false). */
const PAYLOAD_OMNI_IMAGEM = {
  message: {
    _id: "019E6F1A9553705584AD73DBA1F995A1",
    channel_id: "019E4C54B1B375A28970B605CA9B03C3",
    created: 1779980473683,
    metadata: { "@class": ".Metadata", forwarded: false, from_api: false, from_me: false, middleware: "Z_API_WHATSAPP" },
    sender: { "@class": ".Sender", identifier: "5511988887777", name: "Maria" },
    recipient: { "@class": ".Recipient", identifier: "5511999990000" },
    contents: [],
    attachments: [
      {
        "@class": ".ImageAttachment",
        caption: "Confira nossa linha de produtos exclusivos!",
        identifier: "019E6F1A9553705584AC33FB12CBAE6B",
        internal_information: {},
        thumbnail_url: "https://exemplo.com/imagem-thumb.png",
        type: "IMAGE",
        url: "https://exemplo.com/imagem.png",
      },
    ],
    actions: [],
  },
  messageEventType: "NEW_MESSAGE",
};

/** Áudio recebido, formato Z_API (ReceivedCallback). */
const PAYLOAD_ZAPI_AUDIO = {
  ...PAYLOAD_REAL,
  messageId: "3EB0AUDIO",
  text: undefined,
  audio: {
    ptt: true,
    seconds: 10,
    audioUrl: "https://storage.z-api.io/audio.ogg",
    mimeType: "audio/ogg; codecs=opus",
    viewOnce: false,
  },
};

describe("POST /api/webhooks/zapi — mídia", () => {
  beforeEach(() => {
    falso.definirPadrao({ data: ID_RECEBIDA, error: null });
    falso.responder("rpc:gravar_midia_recebida", { data: null, error: null });
  });

  it("Omni DEFAULT: registra a imagem pendente, responde e baixa depois", async () => {
    const f = vi.fn().mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3]), { headers: { "Content-Type": "image/png" } }),
    );
    vi.stubGlobal("fetch", f);
    const r = await POST(requisicao(PAYLOAD_OMNI_IMAGEM));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ registrada: true });
    expect(falso.chamadasRpc("registrar_recebida")).toHaveLength(0);
    expect(falso.chamadasRpc("registrar_recebida_midia").map((c) => c.args[0])).toEqual([
      {
        p_telefone: "5511988887777",
        p_id_externo: "019E6F1A9553705584AD73DBA1F995A1",
        p_midia_tipo: "imagem",
        p_midia_url_origem: "https://exemplo.com/imagem.png",
        p_midia_mime: null,
        p_midia_nome: null,
        p_midia_tamanho: null,
        p_legenda: "Confira nossa linha de produtos exclusivos!",
      },
    ]);
    // Nada baixado antes da resposta.
    expect(f).not.toHaveBeenCalled();
    await rodarDepois();
    expect(f).toHaveBeenCalledTimes(1);
    expect(falso.chamadasDe("storage:whatsapp-midia", "upload")[0].args[0]).toMatch(
      new RegExp(`^\\d{4}/\\d{2}/${ID_RECEBIDA}\\.png$`),
    );
    expect(falso.chamadasRpc("gravar_midia_recebida")[0].args[0]).toMatchObject({
      p_id: ID_RECEBIDA,
      p_status: "salva",
    });
  });

  it("Z_API: áudio com mime do provedor", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(new Uint8Array([1]))));
    const r = await POST(requisicao(PAYLOAD_ZAPI_AUDIO));
    expect(await r.json()).toEqual({ registrada: true });
    expect(falso.chamadasRpc("registrar_recebida_midia")[0].args[0]).toMatchObject({
      p_telefone: "5511988887777",
      p_id_externo: "3EB0AUDIO",
      p_midia_tipo: "audio",
      p_midia_url_origem: "https://storage.z-api.io/audio.ogg",
      p_midia_mime: "audio/ogg; codecs=opus",
    });
    await rodarDepois();
    expect(falso.chamadasDe("storage:whatsapp-midia", "upload")[0].args[0]).toMatch(/\.ogg$/);
  });

  it("falha no download não quebra o webhook: 200 e a mídia fica 'falhou'", async () => {
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    const r = await POST(requisicao(PAYLOAD_OMNI_IMAGEM));
    expect(r.status).toBe(200);
    await expect(rodarDepois()).resolves.toBeUndefined();
    expect(falso.chamadasRpc("gravar_midia_recebida")[0].args[0]).toMatchObject({
      p_status: "falhou",
    });
    expect(falso.chamadasDe("storage:whatsapp-midia")).toHaveLength(0);
    aviso.mockRestore();
  });

  it("mídia de grupo, enviada pelo negócio ou sem URL → ignorada", async () => {
    const m = PAYLOAD_OMNI_IMAGEM.message;
    const anexo = m.attachments[0];
    const casos = [
      { ...PAYLOAD_OMNI_IMAGEM, message: { ...m, metadata: { ...m.metadata, from_me: true } } },
      {
        ...PAYLOAD_OMNI_IMAGEM,
        message: {
          ...m,
          attachments: [{ ...anexo, internal_information: { group_id: "120363-group" } }],
        },
      },
      { ...PAYLOAD_OMNI_IMAGEM, message: { ...m, attachments: [{ ...anexo, url: "" }] } },
      { ...PAYLOAD_ZAPI_AUDIO, isGroup: true },
      { ...PAYLOAD_ZAPI_AUDIO, audio: { ptt: true } },
    ];
    for (const c of casos) expect(await (await POST(requisicao(c))).json()).toEqual({ ignorada: true });
    expect(falso.chamadasRpc("registrar_recebida_midia")).toHaveLength(0);
    expect(depois).toHaveLength(0);
  });

  it("erro do banco ao registrar a mídia → 500, sem download", async () => {
    const erro = vi.spyOn(console, "error").mockImplementation(() => {});
    falso.responder("rpc:registrar_recebida_midia", { data: null, error: { message: "boom" } });
    expect((await POST(requisicao(PAYLOAD_OMNI_IMAGEM))).status).toBe(500);
    expect(depois).toHaveLength(0);
    erro.mockRestore();
  });
});
