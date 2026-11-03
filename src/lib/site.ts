import "server-only";
import { headers } from "next/headers";

/**
 * URL pública do sistema (sem barra final). Usa NEXT_PUBLIC_SITE_URL quando
 * definida; senão deduz do cabeçalho da requisição atual.
 */
export async function urlDoSite(): Promise<string> {
  const configurada = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (configurada) return configurada.replace(/\/+$/, "");

  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto =
    h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}
