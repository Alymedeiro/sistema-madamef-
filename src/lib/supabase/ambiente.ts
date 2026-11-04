// Variáveis públicas do Supabase e janela de inatividade da sessão.
// Seguro para Client e Server Components (nada secreto aqui).

/** Sessão expira após 12 h de inatividade (spec §2). */
export const JANELA_INATIVIDADE_SEGUNDOS = 12 * 60 * 60;

export function variaveisSupabase(): { url: string; anonKey: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      "Defina NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY (veja .env.example).",
    );
  }
  return { url, anonKey };
}
