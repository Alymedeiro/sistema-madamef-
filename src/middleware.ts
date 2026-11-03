import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@/lib/supabase/tipos";
import { variaveisSupabase } from "@/lib/supabase/ambiente";
import {
  cookiesDaResposta,
  sessaoExpiradaPorInatividade,
  type CookieParaEscrever,
} from "@/lib/supabase/cookies-sessao";

/**
 * Renova a sessão Supabase a cada requisição e manda quem não está logado para
 * /login. Qualquer erro de autenticação (inclusive Supabase fora do ar ou sem
 * configuração) conta como "sem sessão": nunca derruba a requisição e nunca
 * redireciona em laço, porque /login é sempre público.
 *
 * Quem decide se o usuário é um colaborador ATIVO é `lib/sessao.ts` (consulta
 * o banco); aqui só se confirma que há um login válido.
 */
export async function middleware(request: NextRequest) {
  const { pathname, searchParams } = request.nextUrl;
  const ehLogin = pathname === "/login" || pathname.startsWith("/login/");

  const escritos: CookieParaEscrever[] = [];
  const cabecalhos: Record<string, string> = {};
  const existentes = request.cookies.getAll();
  // Login (POST) grava tokens e cookie de atividade na própria resposta da ação;
  // não mexer nos cookies antigos aí para não competir com ela.
  const postDeLogin = ehLogin && request.method === "POST";
  const expirada = !postDeLogin && sessaoExpiradaPorInatividade(existentes);
  let encerrada = expirada; // sessão encerrada aqui: remover os sb-* da resposta
  let temSessao = false;
  let supabase: ReturnType<typeof createServerClient<Database>> | null = null;

  try {
    const { url, anonKey } = variaveisSupabase();
    supabase = createServerClient<Database>(url, anonKey, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value, options }) => {
            request.cookies.set(name, value);
            escritos.push({ name, value, options });
          });
          Object.assign(cabecalhos, headers);
        },
      },
    });
    if (expirada) {
      // 12 h sem uso: encerra a sessão. Os cookies sb-* são removidos abaixo
      // mesmo que o signOut falhe (ex.: Supabase fora do ar).
      try {
        await supabase.auth.signOut({ scope: "local" });
      } catch {
        // ignorado de propósito
      }
    } else {
      const { data, error } = await supabase.auth.getClaims();
      temSessao = !error && !!data?.claims?.sub;
    }
  } catch {
    temSessao = false;
  }

  // Colaborador inativo é mandado para /login?motivo=inativo por `exigirPerfil`;
  // aqui a sessão dele é encerrada (só o middleware consegue limpar cookies).
  if (ehLogin && searchParams.get("motivo") === "inativo" && temSessao && supabase) {
    try {
      await supabase.auth.signOut({ scope: "local" });
    } catch {
      // Sem backend: os cookies são descartados abaixo mesmo assim.
    }
    temSessao = false;
    encerrada = true;
  }

  let resposta: NextResponse;
  if (!temSessao && !ehLogin) {
    const destino = request.nextUrl.clone();
    destino.pathname = "/login";
    destino.search = "";
    resposta = NextResponse.redirect(destino);
  } else {
    resposta = NextResponse.next({ request });
  }

  // Nunca reenviamos sb-* que esta requisição não renovou (ver cookies-sessao.ts).
  cookiesDaResposta({ existentes, escritos, temSessao, expirada: encerrada }).forEach(
    ({ name, value, options }) => resposta.cookies.set(name, value, options),
  );
  Object.entries(cabecalhos).forEach(([k, v]) => resposta.headers.set(k, v));

  return resposta;
}

export const config = {
  matcher: [
    // Tudo, exceto estáticos do Next, logo/ícones/manifest e arquivos de imagem.
    "/((?!_next/static|_next/image|brand/|icons/|favicon\\.ico|manifest\\.webmanifest|apple-touch-icon\\.png|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
