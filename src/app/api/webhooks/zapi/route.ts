import { after } from "next/server";
import { normalizarWhatsApp } from "@/lib/dominio/telefone";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  extrairMidiaOmni,
  extrairMidiaZapi,
  salvarMidiaRecebida,
  type MidiaRecebida,
} from "@/lib/whatsapp/midia";
import { tokenConfere } from "@/lib/whatsapp/token";

export const dynamic = "force-dynamic";
// O download da mídia (até 20 s) roda depois da resposta, com after().
export const maxDuration = 60;

const json = (corpo: Record<string, unknown>, status = 200) => Response.json(corpo, { status });
const IGNORADA = { ignorada: true } as const;

type Recebida = {
  telefone: string;
  texto: string;
  idExterno: string;
  /** Foto, figurinha, vídeo, áudio ou documento (texto vazio). */
  midia?: MidiaRecebida;
};

const textoNaoVazio = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";

/** messageId maior que isso não é da Z-API → ignorada. */
const MAX_ID_EXTERNO = 200;
/** Telefone fora do padrão é guardado como veio, cortado neste tamanho. */
const MAX_TELEFONE = 40;

/**
 * Extrai uma mensagem de texto recebida do callback "on-message-received" da
 * Z-API (ReceivedCallback), de texto ou mídia. Mensagens nossas (fromMe), de
 * grupo, de canal, sem texto nem mídia, sem messageId (ou com mais de 200 caracteres) ou sem telefone →
 * null (ignoradas). WhatsApp com 12 dígitos (sem o 9) vai como veio: o banco
 * procura a cliente com e sem o 9.
 */
function montar(
  telefone: string,
  texto: string,
  idExterno: string,
  midia?: MidiaRecebida,
): Recebida | null {
  const id = idExterno.trim();
  if (id.length > MAX_ID_EXTERNO) return null;
  return {
    // Número fora do padrão (ex.: estrangeiro) vai como veio; o banco guarda.
    telefone: normalizarWhatsApp(telefone) ?? telefone.trim().slice(0, MAX_TELEFONE),
    texto: midia ? "" : texto,
    idExterno: id,
    ...(midia ? { midia } : {}),
  };
}

const objeto = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

/**
 * Formato padrão (DEFAULT) do webhook de canal da Z-API Omni:
 * { message: { _id, metadata: { from_me }, sender: { identifier },
 * contents: [{ type: "TEXT", message, internal_information?: { group_id } }],
 * attachments: [{ type: "IMAGE" | "VIDEO" | ..., url, caption? }] } }.
 * Enviadas pelo negócio (from_me), de grupo ou sem texto nem mídia → null.
 * Com mídia, o texto (se houver) vira a legenda quando o anexo não tem uma.
 */
function extrairRecebidaOmni(c: Record<string, unknown>): Recebida | null {
  const m = objeto(c.message);
  if (!m) return null;
  if (objeto(m.metadata)?.from_me === true) return null;
  const itens = [
    ...(Array.isArray(m.contents) ? m.contents : []),
    ...(Array.isArray(m.attachments) ? m.attachments : []),
  ]
    .map(objeto)
    .filter((x) => x !== null);
  if (itens.some((x) => textoNaoVazio(objeto(x.internal_information)?.group_id))) return null;
  const texto = itens.find((x) => x.type === "TEXT" && textoNaoVazio(x.message))?.message;
  const midia = extrairMidiaOmni(m.attachments);
  const telefone = objeto(m.sender)?.identifier;
  if (!textoNaoVazio(m._id) || !textoNaoVazio(telefone)) return null;
  if (midia) {
    const legenda = midia.legenda ?? (textoNaoVazio(texto) ? texto.trim() : null);
    return montar(telefone, "", m._id, { ...midia, legenda });
  }
  if (!textoNaoVazio(texto)) return null;
  return montar(telefone, texto, m._id);
}

function extrairRecebida(corpo: unknown): Recebida | null {
  if (!corpo || typeof corpo !== "object" || Array.isArray(corpo)) return null;
  const c = corpo as Record<string, unknown>;
  if (objeto(c.message)) return extrairRecebidaOmni(c);
  if (c.fromMe === true || c.isGroup === true || c.isNewsletter === true) return null;
  const texto = objeto(c.text)?.message;
  if (!textoNaoVazio(c.messageId) || !textoNaoVazio(c.phone)) return null;
  if (textoNaoVazio(texto)) return montar(c.phone, texto, c.messageId);
  const midia = extrairMidiaZapi(c);
  return midia ? montar(c.phone, "", c.messageId, midia) : null;
}

/**
 * Webhook da Z-API: `POST /api/webhooks/zapi?token=<ZAPI_WEBHOOK_TOKEN>`.
 * Token errado ou variável ausente → 401. O resto que não interessa → 200
 * ignorada (a Z-API não deve insistir). registrar_recebida (e
 * registrar_recebida_midia) é idempotente pelo messageId.
 *
 * Mídia: registra como 'pendente' e responde; o download (timeout de 20 s,
 * até 16 MB) e a subida para o Storage rodam depois da resposta, com after()
 * — o Omni conta resposta lenta como falha e reenvia. Falha no download não
 * muda a resposta (200): a mensagem fica 'falhou'.
 */
export async function POST(req: Request) {
  const token = new URL(req.url).searchParams.get("token");
  if (!tokenConfere(token, process.env.ZAPI_WEBHOOK_TOKEN)) {
    return json({ erro: "Não autorizado" }, 401);
  }

  let corpo: unknown;
  try {
    corpo = await req.json();
  } catch {
    return json(IGNORADA);
  }
  const recebida = extrairRecebida(corpo);
  if (!recebida) return json(IGNORADA);

  const admin = createAdminClient();
  const { midia } = recebida;
  if (!midia) {
    const { error } = await admin.rpc("registrar_recebida", {
      p_telefone: recebida.telefone,
      p_texto: recebida.texto,
      p_id_externo: recebida.idExterno,
    });
    if (error) {
      console.error("whatsapp: falha em registrar_recebida", error.message);
      return json({ erro: "Falha ao registrar" }, 500);
    }
    return json({ registrada: true });
  }

  const { data, error } = await admin.rpc("registrar_recebida_midia", {
    p_telefone: recebida.telefone,
    p_id_externo: recebida.idExterno,
    p_midia_tipo: midia.tipo,
    p_midia_url_origem: midia.url,
    p_midia_mime: midia.mime,
    p_midia_nome: midia.nome,
    p_midia_tamanho: midia.tamanho,
    p_legenda: midia.legenda,
  });
  if (error || typeof data !== "string") {
    console.error("whatsapp: falha em registrar_recebida_midia", error?.message ?? "sem id");
    return json({ erro: "Falha ao registrar" }, 500);
  }
  after(() => salvarMidiaRecebida(admin, data, midia));
  return json({ registrada: true });
}
