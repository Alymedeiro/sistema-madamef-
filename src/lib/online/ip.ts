import { createHmac } from "node:crypto";

/** HMAC-SHA256 (hex) do primeiro IP de x-forwarded-for. O IP nunca é gravado. */
export function ipHash(cabecalhos: Headers): string {
  const ip =
    cabecalhos.get("x-forwarded-for")?.split(",")[0]?.trim() || "desconhecido";
  return createHmac("sha256", process.env.SUPABASE_SERVICE_ROLE_KEY ?? "")
    .update(ip)
    .digest("hex");
}
