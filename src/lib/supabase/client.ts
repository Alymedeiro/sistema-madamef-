import { createBrowserClient as criarClienteNavegador } from "@supabase/ssr";
import type { Database } from "./tipos";
import { variaveisSupabase } from "./ambiente";

/** Cliente Supabase para Client Components (usa só a chave pública). */
export function createBrowserClient() {
  const { url, anonKey } = variaveisSupabase();
  return criarClienteNavegador<Database>(url, anonKey);
}
