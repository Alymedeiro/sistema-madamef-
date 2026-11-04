import { JANELA_INATIVIDADE_SEGUNDOS } from "./ambiente";

type CookieOpcoes = {
  maxAge?: number;
  path?: string;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: boolean | "lax" | "strict" | "none";
  [chave: string]: unknown;
};

export type CookieParaEscrever = {
  name: string;
  value: string;
  options: CookieOpcoes;
};

/**
 * Cookie próprio de atividade. Os cookies `sb-*` (tokens do Supabase) NUNCA são
 * reescritos por nós: só o @supabase/ssr os grava, e só quando renova o token.
 * Reenviar valores antigos numa resposta atrasada desfaria uma renovação
 * concorrente e, com a rotação do refresh token, derrubaria a sessão.
 * A janela de 12 h de inatividade fica neste cookie, renovado a cada requisição.
 */
export const COOKIE_ATIVIDADE = "ultima_atividade";

type CookieLido = { name: string; value: string };

const ehCookieDeSessao = (c: CookieLido) => c.name.startsWith("sb-");

export function temCookieDeSessao(existentes: CookieLido[]): boolean {
  return existentes.some(ehCookieDeSessao);
}

/** Há tokens do Supabase, mas o cookie de atividade sumiu (expirou em 12 h). */
export function sessaoExpiradaPorInatividade(existentes: CookieLido[]): boolean {
  return (
    temCookieDeSessao(existentes) &&
    !existentes.some((c) => c.name === COOKIE_ATIVIDADE)
  );
}

export function cookieDeAtividade(
  agora: number = Date.now(),
  producao: boolean = process.env.NODE_ENV === "production",
): CookieParaEscrever {
  return {
    name: COOKIE_ATIVIDADE,
    value: String(agora),
    options: {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      secure: producao,
      maxAge: JANELA_INATIVIDADE_SEGUNDOS,
    },
  };
}

/**
 * Cookies a enviar na resposta do middleware.
 * - `expirada`: remove todos os `sb-*` da requisição (mesmo que o signOut do
 *   Supabase tenha falhado) e não renova a atividade.
 * - caso contrário: só o que o Supabase gravou agora (`escritos`, ex.: refresh)
 *   e, havendo sessão, o cookie de atividade renovado. Nada de `sb-*` antigo.
 */
export function cookiesDaResposta(args: {
  existentes: CookieLido[];
  escritos: CookieParaEscrever[];
  temSessao: boolean;
  expirada: boolean;
  agora?: number;
}): CookieParaEscrever[] {
  const { existentes, escritos, temSessao, expirada, agora } = args;

  if (expirada) {
    const resultado = new Map<string, CookieParaEscrever>();
    for (const c of escritos) resultado.set(c.name, c);
    for (const c of existentes.filter(ehCookieDeSessao)) {
      resultado.set(c.name, {
        name: c.name,
        value: "",
        options: { path: "/", maxAge: 0 },
      });
    }
    return [...resultado.values()];
  }

  return temSessao ? [...escritos, cookieDeAtividade(agora)] : [...escritos];
}
