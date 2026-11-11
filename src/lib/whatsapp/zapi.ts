import "server-only";

export type ResultadoEnvio =
  | { ok: true; idExterno: string }
  | { ok: false; erro: string; desconectado: boolean };

type Credenciais = { instancia: string; token: string; clientToken: string };

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
