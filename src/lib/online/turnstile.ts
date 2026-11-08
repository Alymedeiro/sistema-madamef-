const URL_VERIFICACAO = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/** Só no servidor. Sem TURNSTILE_SECRET_KEY a verificação é pulada (dev/teste). */
export async function verificarTurnstile(token: string, ip: string | null): Promise<boolean> {
  const segredo = process.env.TURNSTILE_SECRET_KEY;
  if (!segredo) {
    console.warn("TURNSTILE_SECRET_KEY ausente: verificação do Turnstile pulada.");
    return true;
  }
  try {
    const corpo = new URLSearchParams({ secret: segredo, response: token });
    if (ip) corpo.set("remoteip", ip);
    const r = await fetch(URL_VERIFICACAO, { method: "POST", body: corpo });
    if (!r.ok) return false;
    const json = (await r.json()) as { success?: boolean };
    return json.success === true;
  } catch {
    return false;
  }
}
