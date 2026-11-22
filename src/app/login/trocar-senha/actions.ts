"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { concluirTrocaObrigatoria } from "@/lib/auth/troca-obrigatoria";
import { cookieDeAtividade } from "@/lib/supabase/cookies-sessao";
import { createClient } from "@/lib/supabase/server";
import { trocarSenhaSchema } from "./schemas";

export type EstadoTroca = { erro?: string };

const ERRO_CREDENCIAIS = "E-mail ou senha atual incorretos.";
const ERRO_GENERICO = "Não foi possível trocar a senha agora. Tente novamente em instantes.";

/**
 * Confere e-mail + senha atual (entrando), grava a nova senha e segue para o
 * Início já logado. Se a troca falhar depois de entrar, sai de novo.
 */
export async function trocarSenha(
  _estado: EstadoTroca,
  formData: FormData,
): Promise<EstadoTroca> {
  const parsed = trocarSenhaSchema.safeParse({
    email: String(formData.get("email") ?? ""),
    atual: String(formData.get("atual") ?? ""),
    senha: String(formData.get("senha") ?? ""),
    confirmacao: String(formData.get("confirmacao") ?? ""),
  });
  if (!parsed.success) return { erro: parsed.error.issues[0].message };
  const { email, atual, senha } = parsed.data;

  try {
    const supabase = await createClient();
    const login = await supabase.auth.signInWithPassword({ email, password: atual });
    if (login.error) {
      const recusada =
        login.error.status !== undefined && login.error.status >= 400 && login.error.status < 500;
      return { erro: recusada ? ERRO_CREDENCIAIS : ERRO_GENERICO };
    }
    const { error } = await supabase.auth.updateUser({ password: senha });
    if (error) {
      await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
      if (error.code === "same_password") {
        return { erro: "A nova senha precisa ser diferente da atual." };
      }
      if (error.code === "weak_password") {
        return { erro: "Senha fraca demais. Use uma senha mais longa e variada." };
      }
      return { erro: ERRO_GENERICO };
    }
    if (login.data.user?.app_metadata?.deve_trocar_senha === true) {
      await concluirTrocaObrigatoria(supabase, login.data.user.id);
    }
    const atividade = cookieDeAtividade();
    (await cookies()).set(atividade.name, atividade.value, atividade.options);
  } catch {
    return { erro: ERRO_GENERICO };
  }

  redirect("/inicio");
}
