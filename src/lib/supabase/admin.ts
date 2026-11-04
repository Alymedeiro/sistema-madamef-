import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "./tipos";

/**
 * Cliente com a service role: ignora o RLS. Só no servidor (Server Actions e
 * Route Handlers que já checaram o perfil da dona). Nunca importar de um
 * Client Component; `server-only` faz o build falhar se alguém tentar.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error(
      "Defina NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY (veja .env.example).",
    );
  }
  return createClient<Database>(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
