import { formatarNoFuso } from "@/lib/dominio/tempo";
import type { createAdminClient } from "@/lib/supabase/admin";

/**
 * Mídia recebida pelo webhook do WhatsApp (Z-API Omni nos formatos DEFAULT e
 * Z_API; Z-API tradicional). O webhook registra a mensagem como 'pendente' e,
 * depois da resposta (after() do Next), salvarMidiaRecebida baixa o arquivo
 * do provedor e o guarda no bucket privado `whatsapp-midia`.
 */
export type TipoMidia = "imagem" | "figurinha" | "video" | "audio" | "documento";
export type StatusMidia = "pendente" | "salva" | "falhou" | "grande_demais";

export type MidiaRecebida = {
  tipo: TipoMidia;
  /** URL do arquivo no provedor (http/https). */
  url: string;
  mime: string | null;
  nome: string | null;
  tamanho: number | null;
  legenda: string | null;
};

export const BUCKET_MIDIA = "whatsapp-midia";
/** Limite do WhatsApp para fotos/vídeos/áudios; acima disso fica só no celular. */
export const LIMITE_MIDIA_BYTES = 16 * 1024 * 1024;
export const TIMEOUT_MIDIA_MS = 20_000;
const MAX_URL = 4096;

const objeto = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

const texto = (v: unknown): string | null =>
  typeof v === "string" && v.trim() !== "" ? v.trim() : null;

function urlHttp(v: unknown): string | null {
  const s = texto(v);
  if (!s || s.length > MAX_URL) return null;
  try {
    const u = new URL(s);
    return u.protocol === "https:" || u.protocol === "http:" ? s : null;
  } catch {
    return null;
  }
}

function numero(v: unknown): number | null {
  const n = typeof v === "string" && /^\d+$/.test(v) ? Number(v) : v;
  return typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= 2 ** 31 - 1 ? n : null;
}

const TIPO_OMNI: Record<string, TipoMidia> = {
  IMAGE: "imagem",
  STICKER: "figurinha",
  VIDEO: "video",
  AUDIO: "audio",
  DOCUMENT: "documento",
};

/**
 * Formato DEFAULT do Omni: `message.attachments[]` com `type` (IMAGE, AUDIO,
 * VIDEO, STICKER, DOCUMENT), `url` e `caption` opcional. Documento: `name`
 * (sem extensão) e `extension`, como no envio. Mime e tamanho não aparecem
 * nos exemplos; se vierem (mime_type/mimeType, size/file_size/fileSize), são
 * aproveitados. O primeiro anexo de mídia com URL vale.
 */
export function extrairMidiaOmni(attachments: unknown): MidiaRecebida | null {
  if (!Array.isArray(attachments)) return null;
  for (const a of attachments.map(objeto)) {
    if (!a) continue;
    const tipo = typeof a.type === "string" ? TIPO_OMNI[a.type] : undefined;
    const url = urlHttp(a.url);
    if (!tipo || !url) continue;
    const base = texto(a.name) ?? texto(a.file_name) ?? texto(a.fileName);
    const ext = texto(a.extension);
    const nome = base && ext && !base.toLowerCase().endsWith(`.${ext.toLowerCase()}`) ? `${base}.${ext}` : base;
    return {
      tipo,
      url,
      mime: texto(a.mime_type) ?? texto(a.mimeType) ?? texto(a.mimetype),
      nome,
      tamanho: numero(a.size) ?? numero(a.file_size) ?? numero(a.fileSize),
      legenda: texto(a.caption),
    };
  }
  return null;
}

const CAMPOS_ZAPI: [string, string, TipoMidia][] = [
  ["image", "imageUrl", "imagem"],
  ["sticker", "stickerUrl", "figurinha"],
  ["video", "videoUrl", "video"],
  ["audio", "audioUrl", "audio"],
  ["document", "documentUrl", "documento"],
];

/**
 * Formato Z_API do Omni e Z-API tradicional (ReceivedCallback): `image`
 * {imageUrl, mimeType, caption}, `video` {videoUrl, mimeType, caption},
 * `audio` {audioUrl, mimeType}, `document` {documentUrl, mimeType, fileName,
 * title, caption} e `sticker` {stickerUrl, mimeType}.
 */
export function extrairMidiaZapi(corpo: Record<string, unknown>): MidiaRecebida | null {
  for (const [campo, campoUrl, tipo] of CAMPOS_ZAPI) {
    const m = objeto(corpo[campo]);
    const url = m ? urlHttp(m[campoUrl]) : null;
    if (!m || !url) continue;
    return {
      tipo,
      url,
      mime: texto(m.mimeType) ?? texto(m.mimetype),
      nome: tipo === "documento" ? (texto(m.fileName) ?? texto(m.title)) : null,
      tamanho: numero(m.fileSize) ?? numero(m.size),
      legenda: texto(m.caption),
    };
  }
  return null;
}

const EXTENSAO_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/heic": "heic",
  "video/mp4": "mp4",
  "video/3gpp": "3gp",
  "video/quicktime": "mov",
  "video/webm": "webm",
  "audio/ogg": "ogg",
  "audio/opus": "opus",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/mp4": "m4a",
  "audio/aac": "aac",
  "audio/amr": "amr",
  "audio/wav": "wav",
  "application/pdf": "pdf",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.ms-powerpoint": "ppt",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "text/plain": "txt",
  "text/csv": "csv",
  "application/zip": "zip",
};

const mimeBase = (mime: string | null): string =>
  (mime ?? "").split(";")[0].trim().toLowerCase();

function extensaoDe(nome: string): string | null {
  const m = /\.([a-z0-9]{1,10})$/.exec(nome.toLowerCase());
  return m ? m[1] : null;
}

/** Extensão do arquivo: pelo mime, senão pelo nome, senão pela URL; senão "bin". */
export function extensaoDaMidia(mime: string | null, nome: string | null, url: string): string {
  const porMime = EXTENSAO_MIME[mimeBase(mime)];
  if (porMime) return porMime;
  if (nome) {
    const e = extensaoDe(nome);
    if (e) return e;
  }
  try {
    const e = extensaoDe(new URL(url).pathname);
    if (e) return e;
  } catch {
    // URL inválida: sem extensão
  }
  return "bin";
}

const MIME_PERIGOSO = /^(text\/html|application\/xhtml\+xml|image\/svg\+xml|text\/xml|application\/xml|text\/javascript|application\/javascript|application\/x-javascript)$/;

/** Mime gravado no Storage; tipos que o navegador executaria viram octet-stream. */
export function mimeSeguro(mime: string | null): string {
  const base = mimeBase(mime);
  if (!base || !/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(base) || MIME_PERIGOSO.test(base)) {
    return "application/octet-stream";
  }
  return (mime ?? "").trim().slice(0, 200);
}

/** `<aaaa>/<mm>/<id>.<ext>`, com o mês contado em São Paulo. */
export function caminhoMidia(id: string, ext: string, agora: Date = new Date()): string {
  return `${formatarNoFuso(agora, "yyyy/MM")}/${id}.${ext}`;
}

const ROTULO_MIDIA: Record<TipoMidia, { emoji: string; rotulo: string }> = {
  imagem: { emoji: "📷", rotulo: "📷 Foto" },
  video: { emoji: "🎬", rotulo: "🎬 Vídeo" },
  audio: { emoji: "🎤", rotulo: "🎤 Áudio" },
  documento: { emoji: "📄", rotulo: "📄 Documento" },
  figurinha: { emoji: "", rotulo: "Figurinha" },
};

/** Prévia na lista de conversas: o rótulo do tipo, ou o emoji e a legenda. */
export function rotuloPreviaMidia(tipo: TipoMidia, legenda: string | null): string {
  const r = ROTULO_MIDIA[tipo];
  const l = legenda?.trim();
  if (!l) return r.rotulo;
  return r.emoji ? `${r.emoji} ${l}` : l;
}

/**
 * Authorization para baixar do provedor: só para hosts da Z-API (z-api.io e
 * subdomínios), em https, com a Secret Key do Omni. Os exemplos do Omni não
 * dizem que a URL exige autenticação; o download tenta primeiro sem e só
 * repete com a chave se receber 401/403 — e nunca a manda a outro host.
 */
export function autorizacaoOmni(url: string): string | null {
  const chave = process.env.OMNI_SECRET_KEY;
  if (!chave) return null;
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return null;
    const host = u.hostname.toLowerCase();
    return host === "z-api.io" || host.endsWith(".z-api.io") ? `Bearer ${chave}` : null;
  } catch {
    return null;
  }
}

export type ResultadoDownload =
  | { ok: true; bytes: Uint8Array; mime: string | null }
  | { ok: false; motivo: "grande_demais" | "falhou"; tamanho: number | null };

type OpcoesDownload = {
  fetch?: typeof fetch;
  limite?: number;
  timeoutMs?: number;
  /** Authorization para a URL (usada só numa segunda tentativa, após 401/403). */
  autorizacao?: (url: string) => string | null;
};

async function lerComLimite(r: Response, limite: number): Promise<Uint8Array | null> {
  if (!r.body) return new Uint8Array(0);
  const leitor = r.body.getReader();
  const pedacos: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await leitor.read();
    if (done) break;
    total += value.byteLength;
    if (total > limite) {
      await leitor.cancel().catch(() => {});
      return null;
    }
    pedacos.push(value);
  }
  const bytes = new Uint8Array(total);
  let pos = 0;
  for (const p of pedacos) {
    bytes.set(p, pos);
    pos += p.byteLength;
  }
  return bytes;
}

/**
 * Baixa a mídia com timeout (20 s, que vale também para a leitura do corpo) e
 * limite de 16 MB: Content-Length acima do limite, ou contagem durante o
 * download → grande_demais. HTTP de erro, rede ou tempo esgotado → falhou.
 */
export async function baixarMidia(url: string, opcoes: OpcoesDownload = {}): Promise<ResultadoDownload> {
  const f = opcoes.fetch ?? fetch;
  const limite = opcoes.limite ?? LIMITE_MIDIA_BYTES;
  const signal = AbortSignal.timeout(opcoes.timeoutMs ?? TIMEOUT_MIDIA_MS);
  const falhou = { ok: false, motivo: "falhou", tamanho: null } as const;
  try {
    let r = await f(url, { headers: {}, signal, redirect: "follow" });
    if (r.status === 401 || r.status === 403) {
      const auth = opcoes.autorizacao?.(url) ?? null;
      if (auth) {
        await r.body?.cancel().catch(() => {});
        r = await f(url, { headers: { Authorization: auth }, signal, redirect: "follow" });
      }
    }
    if (!r.ok) {
      await r.body?.cancel().catch(() => {});
      return falhou;
    }
    const declarado = numero(r.headers.get("content-length"));
    if (declarado !== null && declarado > limite) {
      await r.body?.cancel().catch(() => {});
      return { ok: false, motivo: "grande_demais", tamanho: declarado };
    }
    const bytes = await lerComLimite(r, limite);
    if (!bytes) return { ok: false, motivo: "grande_demais", tamanho: null };
    return { ok: true, bytes, mime: texto(r.headers.get("content-type")) };
  } catch {
    return falhou;
  }
}

type Admin = ReturnType<typeof createAdminClient>;

async function gravar(
  admin: Admin,
  id: string,
  status: Exclude<StatusMidia, "pendente">,
  extra: { path?: string; mime?: string; tamanho?: number | null } = {},
) {
  const { error } = await admin.rpc("gravar_midia_recebida", {
    p_id: id,
    p_status: status,
    p_path: extra.path ?? null,
    p_mime: extra.mime ?? null,
    p_tamanho: extra.tamanho ?? null,
  });
  if (error) console.warn("whatsapp: falha em gravar_midia_recebida", status);
}

/**
 * Baixa a mídia do provedor, sobe para whatsapp-midia/<aaaa>/<mm>/<id>.<ext>
 * (service role) e grava o resultado. Nunca lança; os logs não levam a URL.
 */
export async function salvarMidiaRecebida(
  admin: Admin,
  id: string,
  midia: MidiaRecebida,
  deps: { fetch?: typeof fetch; agora?: Date } = {},
): Promise<Exclude<StatusMidia, "pendente">> {
  try {
    const r = await baixarMidia(midia.url, { fetch: deps.fetch, autorizacao: autorizacaoOmni });
    if (!r.ok) {
      console.warn("whatsapp: mídia não baixada", r.motivo);
      await gravar(admin, id, r.motivo, { tamanho: r.tamanho });
      return r.motivo;
    }
    const mime = mimeSeguro(
      midia.mime ?? (mimeBase(r.mime) === "application/octet-stream" ? null : r.mime),
    );
    const ext = extensaoDaMidia(midia.mime ?? r.mime, midia.nome, midia.url);
    const path = caminhoMidia(id, ext, deps.agora);
    const { error } = await admin.storage
      .from(BUCKET_MIDIA)
      .upload(path, r.bytes, { contentType: mime, upsert: true });
    if (error) {
      console.warn("whatsapp: falha ao guardar a mídia no Storage");
      await gravar(admin, id, "falhou");
      return "falhou";
    }
    await gravar(admin, id, "salva", { path, mime, tamanho: r.bytes.length });
    return "salva";
  } catch (e) {
    console.warn("whatsapp: erro ao salvar a mídia", e instanceof Error ? e.name : "erro");
    await gravar(admin, id, "falhou").catch(() => {});
    return "falhou";
  }
}
