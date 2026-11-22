import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { createClient } from "@/lib/supabase/server";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/**
 * Depois que a pessoa cria a própria senha: tira a marca de senha provisória
 * (app_metadata) e renova a sessão para o token novo já vir sem ela. Falhas
 * aqui não desfazem a troca; no pior caso a tela pede a senha de novo.
 */
export async function concluirTrocaObrigatoria(supabase: Supabase, userId: string): Promise<void> {
  try {
    await createAdminClient().auth.admin.updateUserById(userId, {
      app_metadata: { deve_trocar_senha: false },
    });
    await supabase.auth.refreshSession();
  } catch {
    // ver acima
  }
}
