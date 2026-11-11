import { normalizarWhatsApp } from "@/lib/dominio/telefone";
import { createAdminClient } from "@/lib/supabase/admin";
import { tokenConfere } from "@/lib/whatsapp/token";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const json = (corpo: Record<string, unknown>, status = 200) => Response.json(corpo, { status });
const IGNORADA = { ignorada: true } as const;

type Recebida = { telefone: string; texto: string; idExterno: string };

const textoNaoVazio = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";

/** messageId maior que isso não é da Z-API → ignorada. */
const MAX_ID_EXTERNO = 200;
/** Telefone fora do padrão é guardado como veio, cortado neste tamanho. */
const MAX_TELEFONE = 40;

/**
 * Extrai uma mensagem de texto recebida do callback "on-message-received" da
 * Z-API (ReceivedCallback). Mensagens nossas (fromMe), de grupo, de canal,
 * sem texto, sem messageId (ou com mais de 200 caracteres) ou sem telefone →
 * null (ignoradas). WhatsApp com 12 dígitos (sem o 9) vai como veio: o banco
 * procura a cliente com e sem o 9.
 */
function extrairRecebida(corpo: unknown): Recebida | null {
  if (!corpo || typeof corpo !== "object" || Array.isArray(corpo)) return null;
  const c = corpo as Record<string, unknown>;
  if (c.fromMe === true || c.isGroup === true || c.isNewsletter === true) return null;
  const texto = (c.text as Record<string, unknown> | null | undefined)?.message;
  if (!textoNaoVazio(texto) || !textoNaoVazio(c.messageId) || !textoNaoVazio(c.phone)) return null;
  const idExterno = c.messageId.trim();
  if (idExterno.length > MAX_ID_EXTERNO) return null;
  return {
    // Número fora do padrão (ex.: estrangeiro) vai como veio; o banco guarda.
    telefone: normalizarWhatsApp(c.phone) ?? c.phone.trim().slice(0, MAX_TELEFONE),
    texto,
    idExterno,
  };
}

/**
 * Webhook da Z-API: `POST /api/webhooks/zapi?token=<ZAPI_WEBHOOK_TOKEN>`.
 * Token errado ou variável ausente → 401. O resto que não interessa → 200
 * ignorada (a Z-API não deve insistir). registrar_recebida é idempotente
 * pelo messageId.
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

  const { error } = await createAdminClient().rpc("registrar_recebida", {
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
