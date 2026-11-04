"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cookieDeAtividade } from "@/lib/supabase/cookies-sessao";
import { createClient } from "@/lib/supabase/server";

export type EstadoLogin = { erro?: string };

const ERRO_CREDENCIAIS = "E-mail ou senha incorretos";
const ERRO_CONEXAO = "Não foi possível entrar agora. Tente novamente em instantes.";

export async function entrar(
  _estado: EstadoLogin,
  formData: FormData,
): Promise<EstadoLogin> {
  const email = String(formData.get("email") ?? "").trim();
  const senha = String(formData.get("senha") ?? "");
  if (!email || !senha) return { erro: ERRO_CREDENCIAIS };

  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password: senha,
    });
    if (error) {
      // 4xx = credenciais recusadas; sem status (rede) ou 5xx = falha de conexão.
      const recusada = error.status !== undefined && error.status >= 400 && error.status < 500;
      return { erro: recusada ? ERRO_CREDENCIAIS : ERRO_CONEXAO };
    }
    // Abre a janela de 12 h de inatividade (o middleware a renova a cada uso).
    const atividade = cookieDeAtividade();
    (await cookies()).set(atividade.name, atividade.value, atividade.options);
  } catch {
    return { erro: ERRO_CONEXAO };
  }

  redirect("/inicio");
}

export async function sair(): Promise<void> {
  try {
    const supabase = await createClient();
    await supabase.auth.signOut({ scope: "local" });
  } catch {
    // Mesmo sem conexão, volta ao login.
  }
  redirect("/login");
}
