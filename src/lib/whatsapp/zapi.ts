import "server-only";

export type ResultadoEnvio =
  | { ok: true; idExterno: string }
  | { ok: false; erro: string; desconectado: boolean };

type Credenciais = { instancia: string; token: string; clientToken: string };

/**
 * Z-API Omni (canal WhatsApp Web): Secret Key do menu Segurança e o ID do
 * canal. Quando as duas estão definidas, o envio usa a Omni; senão, a Z-API
 * tradicional (instância + token + Client-Token).
 */
type CredenciaisOmni = { secretKey: string; canal: string };

const BASE_OMNI = "https://api.omni.z-api.io/v1/channels";

export function credenciaisOmni(): CredenciaisOmni | null {
  const secretKey = process.env.OMNI_SECRET_KEY;
  const canal = process.env.OMNI_CHANNEL_ID;
  if (!secretKey || !canal) return null;
  return { secretKey, canal };
}

/** Há chaves de algum dos dois provedores. */
export function temChavesWhatsapp(): boolean {
  return credenciaisOmni() !== null || credenciaisZapi() !== null;
}

function lerJson(bruto: string): Record<string, unknown> {
  try {
    const p: unknown = JSON.parse(bruto);
    if (p && typeof p === "object" && !Array.isArray(p)) return p as Record<string, unknown>;
  } catch {
    // corpo não-JSON
  }
  return {};
}

function erroDeRede(e: unknown): ResultadoEnvio {
  const nome = e instanceof Error ? e.name : "";
  if (nome === "TimeoutError" || nome === "AbortError")
    return { ok: false, erro: "Tempo esgotado", desconectado: false };
  return { ok: false, erro: e instanceof Error ? e.message : "Falha de rede", desconectado: false };
}

async function enviarTextoOmni(
  c: CredenciaisOmni,
  telefone: string,
  texto: string,
  f: typeof fetch,
): Promise<ResultadoEnvio> {
  try {
    const r = await f(`${BASE_OMNI}/${encodeURIComponent(c.canal)}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${c.secretKey}` },
      body: JSON.stringify({
        recipient: { identifier: telefone },
        content: { type: "TEXT", body: { message: texto } },
      }),
      signal: AbortSignal.timeout(10000),
    });
    const bruto = await r.text();
    const corpo = lerJson(bruto);
    if (!r.ok) {
      const sub = typeof corpo.subCode === "string" ? corpo.subCode : "";
      const detalhe =
        sub ||
        (typeof corpo.message === "string" && corpo.message) ||
        (typeof corpo.error === "string" && corpo.error) ||
        bruto.slice(0, 200);
      return {
        ok: false,
        erro: `Omni ${r.status}${detalhe ? `: ${detalhe}` : ""}`.slice(0, 300),
        desconectado: sub === "CHANNEL_DISCONNECTED" || DESCONECTADO.test(bruto),
      };
    }
    const id = typeof corpo.messageId === "string" ? corpo.messageId : "";
    if (!id) return { ok: false, erro: "Omni não devolveu id da mensagem", desconectado: false };
    return { ok: true, idExterno: id };
  } catch (e) {
    return erroDeRede(e);
  }
}

async function statusOmni(
  c: CredenciaisOmni,
  f: typeof fetch,
): Promise<"conectado" | "desconectado"> {
  try {
    const r = await f(`${BASE_OMNI}/${encodeURIComponent(c.canal)}/zapi/qr-code/image`, {
      headers: { Authorization: `Bearer ${c.secretKey}` },
      signal: AbortSignal.timeout(10000),
    });
    const corpo = lerJson(await r.text());
    if (r.ok && corpo.connected === true) return "conectado";
    // Diagnóstico sem valores: só o status HTTP e os nomes dos campos.
    console.warn("whatsapp: Omni status", r.status, Object.keys(corpo).join(",") || "(vazio)");
    return "desconectado";
  } catch (e) {
    console.warn("whatsapp: Omni status falhou", e instanceof Error ? e.name : "erro");
    return "desconectado";
  }
}

export function credenciaisZapi(): Credenciais | null {
  const instancia = process.env.ZAPI_INSTANCE_ID;
  const token = process.env.ZAPI_TOKEN;
  const clientToken = process.env.ZAPI_CLIENT_TOKEN;
  if (!instancia || !token || !clientToken) return null;
  return { instancia, token, clientToken };
}

function base(c: Credenciais): string {
  return `https://api.z-api.io/instances/${c.instancia}/token/${c.token}`;
}

const DESCONECTADO = /disconnected|not connected|desconectad/i;

export async function enviarTexto(
  telefone: string,
  texto: string,
  f: typeof fetch = fetch,
): Promise<ResultadoEnvio> {
  const omni = credenciaisOmni();
  if (omni) return enviarTextoOmni(omni, telefone, texto, f);
  const c = credenciaisZapi();
  if (!c) return { ok: false, erro: "Z-API sem chaves configuradas", desconectado: false };
  try {
    const r = await f(`${base(c)}/send-text`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Client-Token": c.clientToken },
      body: JSON.stringify({ phone: telefone, message: texto }),
      signal: AbortSignal.timeout(10000),
    });
    const bruto = await r.text();
    let corpo: Record<string, unknown> = {};
    try {
      const p: unknown = JSON.parse(bruto);
      if (p && typeof p === "object") corpo = p as Record<string, unknown>;
    } catch {
      // corpo não-JSON: usa o texto bruto na mensagem de erro
    }
    if (!r.ok) {
      const detalhe =
        (typeof corpo.error === "string" && corpo.error) ||
        (typeof corpo.message === "string" && corpo.message) ||
        bruto.slice(0, 200);
      return {
        ok: false,
        erro: `Z-API ${r.status}${detalhe ? `: ${detalhe}` : ""}`,
        desconectado: DESCONECTADO.test(bruto),
      };
    }
    const id =
      (typeof corpo.messageId === "string" && corpo.messageId) ||
      (typeof corpo.zaapId === "string" && corpo.zaapId) ||
      (typeof corpo.id === "string" && corpo.id) ||
      "";
    if (!id) return { ok: false, erro: "Z-API não devolveu id da mensagem", desconectado: false };
    return { ok: true, idExterno: id };
  } catch (e) {
    const nome = e instanceof Error ? e.name : "";
    if (nome === "TimeoutError" || nome === "AbortError")
      return { ok: false, erro: "Tempo esgotado", desconectado: false };
    return {
      ok: false,
      erro: e instanceof Error ? e.message : "Falha de rede",
      desconectado: false,
    };
  }
}

export async function statusConexao(
  f: typeof fetch = fetch,
): Promise<"conectado" | "desconectado" | "sem_chaves"> {
  const omni = credenciaisOmni();
  if (omni) return statusOmni(omni, f);
  const c = credenciaisZapi();
  if (!c) return "sem_chaves";
  try {
    const r = await f(`${base(c)}/status`, {
      headers: { "Client-Token": c.clientToken },
      signal: AbortSignal.timeout(10000),
    });
    const corpo = (await r.json()) as { connected?: boolean };
    return r.ok && corpo.connected === true ? "conectado" : "desconectado";
  } catch {
    return "desconectado";
  }
}
