import { afterEach, describe, expect, it, vi } from "vitest";
import { criarSupabaseFalso } from "@/test/supabase-falso";
import {
  BUCKET_MIDIA,
  LIMITE_MIDIA_BYTES,
  autorizacaoOmni,
  baixarMidia,
  caminhoMidia,
  extensaoDaMidia,
  extrairMidiaOmni,
  extrairMidiaZapi,
  mimeSeguro,
  rotuloPreviaMidia,
  salvarMidiaRecebida,
  type MidiaRecebida,
} from "./midia";

afterEach(() => vi.unstubAllEnvs());

/** Anexos dos exemplos da documentação do Omni (webhooks/payloads). */
const ANEXO_IMAGEM = {
  "@class": ".ImageAttachment",
  caption: "Confira nossa linha de produtos exclusivos!",
  identifier: "019E6F1A9553705584AC33FB12CBAE6B",
  internal_information: {},
  thumbnail_url: "https://exemplo.com/imagem-thumb.png",
  type: "IMAGE",
  url: "https://exemplo.com/imagem.png",
};
const ANEXO_AUDIO = {
  "@class": ".AudioAttachment",
  identifier: "019E6F1A96A7748489EBB11ED108DB51",
  internal_information: {},
  type: "AUDIO",
  url: "https://exemplo.com/audio.mp3",
};
const ANEXO_VIDEO = {
  "@class": ".VideoAttachment",
  caption: "Assista e descubra como podemos te ajudar!",
  identifier: "019E6F1A97F57A7BAF9F8945CDF9F269",
  type: "VIDEO",
  url: "https://exemplo.com/video.mp4",
};
const ANEXO_STICKER = {
  "@class": ".StickerAttachment",
  identifier: "019E6F1A9A8D74A097E504E363C5809F",
  type: "STICKER",
  url: "https://exemplo.com/sticker.webp",
};
/** Documento: mesmos campos do envio (url, name sem extensão, extension, caption). */
const ANEXO_DOCUMENTO = {
  "@class": ".DocumentAttachment",
  type: "DOCUMENT",
  url: "https://exemplo.com/nota-fiscal.pdf",
  name: "nota-fiscal",
  extension: "pdf",
  caption: "Segue a sua nota fiscal",
};

describe("extrairMidiaOmni", () => {
  it("imagem, áudio, vídeo, figurinha e documento dos exemplos da documentação", () => {
    expect(extrairMidiaOmni([ANEXO_IMAGEM])).toEqual({
      tipo: "imagem",
      url: "https://exemplo.com/imagem.png",
      mime: null,
      nome: null,
      tamanho: null,
      legenda: "Confira nossa linha de produtos exclusivos!",
    });
    expect(extrairMidiaOmni([ANEXO_AUDIO])).toMatchObject({ tipo: "audio", legenda: null });
    expect(extrairMidiaOmni([ANEXO_VIDEO])).toMatchObject({
      tipo: "video",
      url: "https://exemplo.com/video.mp4",
      legenda: "Assista e descubra como podemos te ajudar!",
    });
    expect(extrairMidiaOmni([ANEXO_STICKER])).toMatchObject({ tipo: "figurinha" });
    expect(extrairMidiaOmni([ANEXO_DOCUMENTO])).toMatchObject({
      tipo: "documento",
      nome: "nota-fiscal.pdf",
      legenda: "Segue a sua nota fiscal",
    });
  });

  it("lê mime e tamanho quando vierem", () => {
    expect(
      extrairMidiaOmni([{ ...ANEXO_AUDIO, mime_type: "audio/ogg; codecs=opus", size: 5120 }]),
    ).toMatchObject({ mime: "audio/ogg; codecs=opus", tamanho: 5120 });
    expect(extrairMidiaOmni([{ ...ANEXO_AUDIO, mimeType: "audio/mpeg", fileSize: "77" }])).toMatchObject(
      { mime: "audio/mpeg", tamanho: 77 },
    );
  });

  it("ignora tipo desconhecido, sem URL, URL não http(s) e lista vazia", () => {
    expect(extrairMidiaOmni([])).toBeNull();
    expect(extrairMidiaOmni(undefined)).toBeNull();
    expect(extrairMidiaOmni([{ type: "LOCATION", latitude: 1, longitude: 2 }])).toBeNull();
    expect(extrairMidiaOmni([{ ...ANEXO_IMAGEM, url: undefined }])).toBeNull();
    expect(extrairMidiaOmni([{ ...ANEXO_IMAGEM, url: "data:image/png;base64,AAAA" }])).toBeNull();
    expect(extrairMidiaOmni([{ ...ANEXO_IMAGEM, url: "file:///etc/passwd" }])).toBeNull();
  });
});

/**
 * Formato Z_API (o mesmo do ReceivedCallback da Z-API tradicional): a mídia
 * vem em image/audio/video/document/sticker com *Url e mimeType.
 */
describe("extrairMidiaZapi", () => {
  it("image, audio, video, document e sticker", () => {
    expect(
      extrairMidiaZapi({
        image: {
          mimeType: "image/jpeg",
          imageUrl: "https://storage.z-api.io/abc.jpeg",
          thumbnailUrl: "https://storage.z-api.io/abc-thumb.jpeg",
          caption: "Olha a foto",
          width: 600,
          height: 315,
          viewOnce: false,
        },
      }),
    ).toEqual({
      tipo: "imagem",
      url: "https://storage.z-api.io/abc.jpeg",
      mime: "image/jpeg",
      nome: null,
      tamanho: null,
      legenda: "Olha a foto",
    });
    expect(
      extrairMidiaZapi({
        audio: {
          ptt: true,
          seconds: 10,
          audioUrl: "https://storage.z-api.io/a.ogg",
          mimeType: "audio/ogg; codecs=opus",
          viewOnce: false,
        },
      }),
    ).toMatchObject({ tipo: "audio", mime: "audio/ogg; codecs=opus" });
    expect(
      extrairMidiaZapi({
        video: {
          videoUrl: "https://storage.z-api.io/v.mp4",
          caption: "",
          mimeType: "video/mp4",
          seconds: 13,
        },
      }),
    ).toMatchObject({ tipo: "video", legenda: null });
    expect(
      extrairMidiaZapi({
        document: {
          documentUrl: "https://storage.z-api.io/d.pdf",
          mimeType: "application/pdf",
          title: "Contrato",
          pageCount: 1,
          fileName: "contrato.pdf",
        },
      }),
    ).toMatchObject({ tipo: "documento", nome: "contrato.pdf", mime: "application/pdf" });
    expect(
      extrairMidiaZapi({
        sticker: { stickerUrl: "https://storage.z-api.io/s.webp", mimeType: "image/webp" },
      }),
    ).toMatchObject({ tipo: "figurinha" });
  });

  it("sem mídia ou sem URL → null", () => {
    expect(extrairMidiaZapi({ text: { message: "oi" } })).toBeNull();
    expect(extrairMidiaZapi({ image: { caption: "sem url" } })).toBeNull();
    expect(extrairMidiaZapi({ location: { latitude: 1 } })).toBeNull();
  });
});

describe("extensaoDaMidia, mimeSeguro e caminhoMidia", () => {
  it("extensão pelo mime (sem parâmetros), depois pelo nome, depois pela URL", () => {
    expect(extensaoDaMidia("image/jpeg", null, "https://x/y")).toBe("jpg");
    expect(extensaoDaMidia("audio/ogg; codecs=opus", null, "https://x/y")).toBe("ogg");
    expect(extensaoDaMidia("image/webp", null, "")).toBe("webp");
    expect(extensaoDaMidia("video/mp4", null, "")).toBe("mp4");
    expect(extensaoDaMidia("application/pdf", null, "")).toBe("pdf");
    expect(
      extensaoDaMidia(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        null,
        "",
      ),
    ).toBe("docx");
    expect(extensaoDaMidia(null, "Planilha.XLSX", "")).toBe("xlsx");
    expect(extensaoDaMidia("application/octet-stream", "sem-extensao", "https://x/a.mp3?t=1")).toBe(
      "mp3",
    );
    expect(extensaoDaMidia(null, "../../etc/passwd", "https://x/")).toBe("bin");
    expect(extensaoDaMidia(null, "x.muito-longa-demais", "")).toBe("bin");
  });

  it("tipos que o navegador executaria viram octet-stream", () => {
    expect(mimeSeguro("text/html; charset=utf-8")).toBe("application/octet-stream");
    expect(mimeSeguro("image/svg+xml")).toBe("application/octet-stream");
    expect(mimeSeguro("application/javascript")).toBe("application/octet-stream");
    expect(mimeSeguro("image/jpeg")).toBe("image/jpeg");
    expect(mimeSeguro(null)).toBe("application/octet-stream");
  });

  it("caminho <aaaa>/<mm>/<id>.<ext> no mês de São Paulo", () => {
    expect(caminhoMidia("abc", "jpg", new Date("2026-11-12T15:00:00Z"))).toBe("2026/11/abc.jpg");
    // 01/12 01:00 UTC ainda é 30/11 em São Paulo.
    expect(caminhoMidia("abc", "pdf", new Date("2026-12-01T01:00:00Z"))).toBe("2026/11/abc.pdf");
  });
});

describe("rotuloPreviaMidia", () => {
  it("rótulo por tipo; com legenda, o emoji e a legenda", () => {
    expect(rotuloPreviaMidia("imagem", null)).toBe("📷 Foto");
    expect(rotuloPreviaMidia("video", null)).toBe("🎬 Vídeo");
    expect(rotuloPreviaMidia("audio", null)).toBe("🎤 Áudio");
    expect(rotuloPreviaMidia("documento", null)).toBe("📄 Documento");
    expect(rotuloPreviaMidia("figurinha", null)).toBe("Figurinha");
    expect(rotuloPreviaMidia("imagem", "Bom dia")).toBe("📷 Bom dia");
    expect(rotuloPreviaMidia("documento", "  ")).toBe("📄 Documento");
  });
});

describe("autorizacaoOmni", () => {
  it("só para hosts da Z-API, em https, com a Secret Key definida", () => {
    vi.stubEnv("OMNI_SECRET_KEY", "chave");
    vi.stubEnv("OMNI_CHANNEL_ID", "canal");
    expect(autorizacaoOmni("https://api.omni.z-api.io/v1/media/1")).toBe("Bearer chave");
    expect(autorizacaoOmni("https://z-api.io/x")).toBe("Bearer chave");
    expect(autorizacaoOmni("http://api.omni.z-api.io/x")).toBeNull();
    expect(autorizacaoOmni("https://z-api.io.atacante.com/x")).toBeNull();
    expect(autorizacaoOmni("https://exemplo.com/x")).toBeNull();
    expect(autorizacaoOmni("não é url")).toBeNull();
    vi.stubEnv("OMNI_SECRET_KEY", "");
    expect(autorizacaoOmni("https://api.omni.z-api.io/x")).toBeNull();
  });
});

function corpoEmPedacos(pedacos: number[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(ctrl) {
      for (const n of pedacos) ctrl.enqueue(new Uint8Array(n));
      ctrl.close();
    },
  });
}

describe("baixarMidia", () => {
  it("baixa com timeout de 20 s e devolve bytes e Content-Type", async () => {
    const f = vi.fn().mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3]), { headers: { "Content-Type": "image/png" } }),
    );
    const r = await baixarMidia("https://exemplo.com/a.png", { fetch: f });
    expect(r).toEqual({ ok: true, bytes: new Uint8Array([1, 2, 3]), mime: "image/png" });
    const [url, init] = f.mock.calls[0];
    expect(url).toBe("https://exemplo.com/a.png");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.headers).toEqual({});
  });

  it("Content-Length acima de 16 MB → grande_demais sem ler o corpo", async () => {
    const cancelar = vi.fn();
    const corpo = new ReadableStream({ cancel: cancelar });
    const f = vi.fn().mockResolvedValue(
      new Response(corpo, { headers: { "Content-Length": String(LIMITE_MIDIA_BYTES + 1) } }),
    );
    expect(await baixarMidia("https://exemplo.com/v.mp4", { fetch: f })).toEqual({
      ok: false,
      motivo: "grande_demais",
      tamanho: LIMITE_MIDIA_BYTES + 1,
    });
    expect(cancelar).toHaveBeenCalled();
  });

  it("sem Content-Length: conta durante o download e para ao passar do limite", async () => {
    const f = vi.fn().mockResolvedValue(new Response(corpoEmPedacos([6, 6, 6])));
    expect(await baixarMidia("https://exemplo.com/v.mp4", { fetch: f, limite: 16 })).toEqual({
      ok: false,
      motivo: "grande_demais",
      tamanho: null,
    });
    const g = vi.fn().mockResolvedValue(new Response(corpoEmPedacos([8, 8])));
    const ok = await baixarMidia("https://exemplo.com/v.mp4", { fetch: g, limite: 16 });
    expect(ok.ok && ok.bytes.length).toBe(16);
  });

  it("HTTP de erro, rede e tempo esgotado → falhou", async () => {
    const e404 = vi.fn().mockResolvedValue(new Response("x", { status: 404 }));
    expect(await baixarMidia("https://exemplo.com/a", { fetch: e404 })).toEqual({
      ok: false,
      motivo: "falhou",
      tamanho: null,
    });
    const rede = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    expect((await baixarMidia("https://exemplo.com/a", { fetch: rede })).ok).toBe(false);
    const tempo = vi.fn().mockRejectedValue(new DOMException("t", "TimeoutError"));
    expect(await baixarMidia("https://exemplo.com/a", { fetch: tempo })).toMatchObject({
      motivo: "falhou",
    });
  });

  it("401/403 tenta de novo com Authorization só quando há autorização para o host", async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 401 }))
      .mockResolvedValueOnce(new Response(new Uint8Array([9])));
    const r = await baixarMidia("https://api.omni.z-api.io/m/1", {
      fetch: f,
      autorizacao: () => "Bearer chave",
    });
    expect(r.ok).toBe(true);
    expect(f.mock.calls[0][1].headers).toEqual({});
    expect(f.mock.calls[1][1].headers).toEqual({ Authorization: "Bearer chave" });

    const g = vi.fn().mockResolvedValue(new Response("", { status: 403 }));
    expect((await baixarMidia("https://exemplo.com/a", { fetch: g, autorizacao: () => null })).ok).toBe(
      false,
    );
    expect(g).toHaveBeenCalledTimes(1);
  });
});

describe("salvarMidiaRecebida", () => {
  const ID = "d0000000-0000-4000-8000-0000000000d1";
  const AGORA = new Date("2026-11-12T15:00:00Z");
  const MIDIA: MidiaRecebida = {
    tipo: "imagem",
    url: "https://exemplo.com/imagem.png",
    mime: null,
    nome: null,
    tamanho: null,
    legenda: null,
  };

  it("baixa, sobe para whatsapp-midia/<aaaa>/<mm>/<id>.<ext> e grava salva", async () => {
    const falso = criarSupabaseFalso();
    falso.definirPadrao({ data: null, error: null });
    const f = vi.fn().mockResolvedValue(
      new Response(new Uint8Array([1, 2]), { headers: { "Content-Type": "image/png" } }),
    );
    expect(await salvarMidiaRecebida(falso.cliente as never, ID, MIDIA, { fetch: f, agora: AGORA })).toBe(
      "salva",
    );
    const [subida] = falso.chamadasDe(`storage:${BUCKET_MIDIA}`, "upload");
    expect(subida.args[0]).toBe(`2026/11/${ID}.png`);
    expect(subida.args[2]).toEqual({ contentType: "image/png", upsert: true });
    expect(falso.chamadasRpc("gravar_midia_recebida")[0].args[0]).toEqual({
      p_id: ID,
      p_status: "salva",
      p_path: `2026/11/${ID}.png`,
      p_mime: "image/png",
      p_tamanho: 2,
    });
  });

  it("o mime informado pelo provedor vale mais que o Content-Type", async () => {
    const falso = criarSupabaseFalso();
    falso.definirPadrao({ data: null, error: null });
    const f = vi.fn().mockResolvedValue(
      new Response(new Uint8Array([1]), { headers: { "Content-Type": "application/octet-stream" } }),
    );
    await salvarMidiaRecebida(
      falso.cliente as never,
      ID,
      { ...MIDIA, tipo: "audio", mime: "audio/ogg; codecs=opus" },
      { fetch: f, agora: AGORA },
    );
    expect(falso.chamadasDe(`storage:${BUCKET_MIDIA}`, "upload")[0].args[0]).toBe(`2026/11/${ID}.ogg`);
  });

  it("grande demais → grava grande_demais com o tamanho, sem subir", async () => {
    const falso = criarSupabaseFalso();
    falso.definirPadrao({ data: null, error: null });
    const f = vi.fn().mockResolvedValue(
      new Response("", { headers: { "Content-Length": String(LIMITE_MIDIA_BYTES + 10) } }),
    );
    expect(await salvarMidiaRecebida(falso.cliente as never, ID, MIDIA, { fetch: f, agora: AGORA })).toBe(
      "grande_demais",
    );
    expect(falso.chamadasDe(`storage:${BUCKET_MIDIA}`)).toHaveLength(0);
    expect(falso.chamadasRpc("gravar_midia_recebida")[0].args[0]).toMatchObject({
      p_status: "grande_demais",
      p_path: null,
      p_tamanho: LIMITE_MIDIA_BYTES + 10,
    });
  });

  it("falha no download ou no upload → grava falhou e não lança", async () => {
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});
    const falso = criarSupabaseFalso();
    falso.definirPadrao({ data: null, error: null });
    const rede = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    expect(await salvarMidiaRecebida(falso.cliente as never, ID, MIDIA, { fetch: rede, agora: AGORA })).toBe(
      "falhou",
    );
    falso.responder(`storage:${BUCKET_MIDIA}:upload`, { data: null, error: { message: "boom" } });
    const ok = vi.fn().mockResolvedValue(new Response(new Uint8Array([1])));
    expect(await salvarMidiaRecebida(falso.cliente as never, ID, MIDIA, { fetch: ok, agora: AGORA })).toBe(
      "falhou",
    );
    expect(falso.chamadasRpc("gravar_midia_recebida").map((c) => c.args[0])).toEqual([
      { p_id: ID, p_status: "falhou", p_path: null, p_mime: null, p_tamanho: null },
      { p_id: ID, p_status: "falhou", p_path: null, p_mime: null, p_tamanho: null },
    ]);
    // Nunca registra a URL (pode ter token).
    expect(JSON.stringify(aviso.mock.calls)).not.toContain("exemplo.com");
    aviso.mockRestore();
  });
});
