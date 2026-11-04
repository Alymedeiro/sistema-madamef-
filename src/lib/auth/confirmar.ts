// Leitura dos parâmetros do link de e-mail (convite e recuperação de senha).
// O template do Supabase aponta para /auth/confirmar?token_hash=...&type=invite|recovery.

export type TipoConfirmacao = "invite" | "recovery";

const TIPOS: readonly string[] = ["invite", "recovery"];
const TOKEN = /^[A-Za-z0-9_-]{1,256}$/;

export function lerConfirmacao(
  params: Pick<URLSearchParams, "get">,
): { tokenHash: string; tipo: TipoConfirmacao } | null {
  const tokenHash = params.get("token_hash");
  const tipo = params.get("type");
  if (!tokenHash || !TOKEN.test(tokenHash)) return null;
  if (!tipo || !TIPOS.includes(tipo)) return null;
  return { tokenHash, tipo: tipo as TipoConfirmacao };
}
