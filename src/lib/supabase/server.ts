import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "./tipos";
import { JANELA_INATIVIDADE_SEGUNDOS, variaveisSupabase } from "./ambiente";

/** Cliente Supabase para Server Components, Server Actions e Route Handlers. */
export async function createClient() {
  const cookieStore = await cookies();
  const { url, anonKey } = variaveisSupabase();

  return createServerClient<Database>(url, anonKey, {
    cookieOptions: { maxAge: JANELA_INATIVIDADE_SEGUNDOS },
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        } catch {
          // Chamado de um Server Component (cookies somente leitura): ignorar.
          // O middleware já renova a sessão a cada requisição.
        }
      },
    },
  });
}
