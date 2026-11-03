"use server";

import { urlDoSite } from "@/lib/site";
import { createClient } from "@/lib/supabase/server";
import { emailRecuperacaoSchema } from "./schemas";

export type EstadoRecuperacao = { erro?: string; enviado?: boolean };

export async function solicitarRecuperacao(
  _estado: EstadoRecuperacao,
  formData: FormData,
): Promise<EstadoRecuperacao> {
  const parsed = emailRecuperacaoSchema.safeParse(String(formData.get("email") ?? ""));
  if (!parsed.success) return { erro: parsed.error.issues[0].message };

  try {
    const supabase = await createClient();
    await supabase.auth.resetPasswordForEmail(parsed.data, {
      redirectTo: `${await urlDoSite()}/auth/confirmar`,
    });
  } catch {
    // Mesma resposta em qualquer caso: não revela se o e-mail existe.
  }
  return { enviado: true };
}
