import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";
import { lerConfirmacao } from "@/lib/auth/confirmar";
import { cookieDeAtividade } from "@/lib/supabase/cookies-sessao";
import { createClient } from "@/lib/supabase/server";

/**
 * Destino dos links de e-mail (convite e recuperação de senha). Troca o
 * token_hash por uma sessão e leva a pessoa a /definir-senha.
 * Link inválido, expirado ou já usado → /login?motivo=link-invalido.
 */
export async function GET(request: NextRequest) {
  const confirmacao = lerConfirmacao(request.nextUrl.searchParams);
  let destino = "/login?motivo=link-invalido";

  if (confirmacao) {
    try {
      const supabase = await createClient();
      const { error } = await supabase.auth.verifyOtp({
        token_hash: confirmacao.tokenHash,
        type: confirmacao.tipo,
      });
      if (!error) {
        // Abre a janela de 12 h de inatividade, como o login; sem este cookie o
        // middleware trata a sessão como expirada e a derruba na hora.
        const atividade = cookieDeAtividade();
        (await cookies()).set(atividade.name, atividade.value, atividade.options);
        destino = "/definir-senha";
      }
    } catch {
      // Backend indisponível: tratado como link inválido.
    }
  }

  redirect(destino);
}
