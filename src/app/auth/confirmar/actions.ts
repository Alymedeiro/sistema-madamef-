"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { lerConfirmacao } from "@/lib/auth/confirmar";
import { cookieDeAtividade } from "@/lib/supabase/cookies-sessao";
import { createClient } from "@/lib/supabase/server";

const LINK_INVALIDO = "/login?motivo=link-invalido";

/**
 * "Continuar" da tela /auth/confirmar: troca o token_hash por uma sessão e
 * leva a pessoa a /definir-senha. Só roda num POST (clique da pessoa), então
 * o pré-carregamento do link por antivírus de e-mail não consome o token.
 * Link inválido, expirado ou já usado → /login?motivo=link-invalido.
 */
export async function confirmarLink(formulario: FormData): Promise<void> {
  const confirmacao = lerConfirmacao({
    get: (campo: string) => {
      const valor = formulario.get(campo);
      return typeof valor === "string" ? valor : null;
    },
  });
  let destino = LINK_INVALIDO;

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
