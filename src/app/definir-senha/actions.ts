"use server";

import { redirect } from "next/navigation";
import { exigirPerfil } from "@/lib/sessao";
import { createClient } from "@/lib/supabase/server";
import { novaSenhaSchema } from "./schemas";

export type EstadoSenha = { erro?: string };

const ERRO_GENERICO = "Não foi possível salvar a senha. Tente novamente.";

export async function definirSenha(
  _estado: EstadoSenha,
  formData: FormData,
): Promise<EstadoSenha> {
  // Qualquer colaborador ativo pode definir a própria senha (sem checar perfil).
  await exigirPerfil();

  const parsed = novaSenhaSchema.safeParse({
    senha: String(formData.get("senha") ?? ""),
    confirmacao: String(formData.get("confirmacao") ?? ""),
  });
  if (!parsed.success) return { erro: parsed.error.issues[0].message };

  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.updateUser({ password: parsed.data.senha });
    if (error) {
      if (error.code === "same_password") {
        return { erro: "A nova senha precisa ser diferente da anterior." };
      }
      if (error.code === "weak_password") {
        return { erro: "Senha fraca demais. Use uma senha mais longa e variada." };
      }
      return { erro: ERRO_GENERICO };
    }
  } catch {
    return { erro: ERRO_GENERICO };
  }

  redirect("/inicio");
}
