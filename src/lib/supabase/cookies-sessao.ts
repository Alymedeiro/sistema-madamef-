import { JANELA_INATIVIDADE_SEGUNDOS } from "./ambiente";

type CookieOpcoes = {
  maxAge?: number;
  path?: string;
  sameSite?: boolean | "lax" | "strict" | "none";
  [chave: string]: unknown;
};

export type CookieParaEscrever = {
  name: string;
  value: string;
  options: CookieOpcoes;
};

/**
 * Janela deslizante de 12 h: a cada requisição, os cookies de sessão do
 * Supabase (`sb-*`) são reemitidos com validade nova. Quem ficar 12 h sem
 * abrir o sistema perde a sessão mesmo que o projeto Supabase não aplique
 * `inactivity_timeout` (recurso de plano pago).
 *
 * `escritos` são os cookies que o Supabase acabou de gravar (ex.: refresh);
 * `existentes` são os que vieram na requisição.
 */
export function cookiesComJanelaDeInatividade(
  existentes: { name: string; value: string }[],
  escritos: CookieParaEscrever[],
  maxAge: number = JANELA_INATIVIDADE_SEGUNDOS,
): CookieParaEscrever[] {
  const resultado = new Map<string, CookieParaEscrever>();

  for (const c of existentes) {
    if (!c.name.startsWith("sb-")) continue;
    resultado.set(c.name, {
      name: c.name,
      value: c.value,
      options: { path: "/", sameSite: "lax" },
    });
  }
  for (const c of escritos) {
    resultado.set(c.name, c);
  }

  return [...resultado.values()].map((c) => {
    const remocao = c.value === "" || c.options.maxAge === 0;
    return remocao ? c : { ...c, options: { ...c.options, maxAge } };
  });
}
