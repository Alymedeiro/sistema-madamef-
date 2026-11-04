export const MAX_BYTES_ASSINATURA = 200 * 1024;

const PREFIXO = "data:image/png;base64,";
const ASSINATURA_PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Decodifica a data URL de uma assinatura; `null` se não for um PNG válido dentro do limite. */
export function decodificarAssinaturaPng(dataUrl: string): Uint8Array | null {
  if (typeof dataUrl !== "string" || !dataUrl.startsWith(PREFIXO)) return null;
  const b64 = dataUrl.slice(PREFIXO.length);
  // Limite antes de decodificar: base64 usa 4 caracteres para 3 bytes.
  if (
    b64.length === 0 ||
    b64.length > Math.ceil((MAX_BYTES_ASSINATURA * 4) / 3) + 4
  )
    return null;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(b64) || b64.length % 4 !== 0) return null;
  const bytes = new Uint8Array(Buffer.from(b64, "base64"));
  if (
    bytes.length > MAX_BYTES_ASSINATURA ||
    bytes.length < ASSINATURA_PNG.length
  )
    return null;
  return ASSINATURA_PNG.every((b, i) => bytes[i] === b) ? bytes : null;
}
