// Anexo das contas a pagar: o navegador envia o arquivo direto ao bucket
// privado `financeiro` com o JWT da dona (política de Storage só da dona) e
// depois a conta é registrada com o caminho (o banco confere que existe).

export const BUCKET_FINANCEIRO = "financeiro";
export const URL_ANEXO_SEGUNDOS = 300;
export const LIMITE_ANEXO_BYTES = 5 * 1024 * 1024;
export const MENSAGEM_ANEXO_RECUSADO = "Escolha uma foto (JPEG ou PNG) ou um PDF de até 5 MB.";
/** Tipos aceitos no `<input type="file">`. */
export const ACEITA_ANEXO = "image/jpeg,image/png,application/pdf";

export type ExtensaoAnexo = "jpg" | "png" | "pdf";

const EXTENSAO: Record<string, ExtensaoAnexo> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "application/pdf": "pdf",
};

/** Extensão do arquivo aceito (JPEG/PNG/PDF, 1 byte a 5 MB) ou null. */
export function extensaoDoAnexo(a: { type: string; size: number }): ExtensaoAnexo | null {
  const ext = EXTENSAO[a.type.trim().toLowerCase()];
  if (!ext || a.size <= 0 || a.size > LIMITE_ANEXO_BYTES) return null;
  return ext;
}

export function caminhoAnexo(id: string, ext: ExtensaoAnexo): string {
  return `contas_pagar/${id}.${ext}`;
}

/**
 * Envia o arquivo ao Storage e devolve o caminho. Lança Error com mensagem
 * pronta para a usuária (tipo/tamanho inválido ou falha no envio).
 */
export async function enviarAnexo(arquivo: File): Promise<string> {
  const ext = extensaoDoAnexo(arquivo);
  if (!ext) throw new Error(MENSAGEM_ANEXO_RECUSADO);
  const { createBrowserClient } = await import("@/lib/supabase/client");
  const supabase = createBrowserClient();
  const path = caminhoAnexo(crypto.randomUUID(), ext);
  const { error } = await supabase.storage
    .from(BUCKET_FINANCEIRO)
    .upload(path, arquivo, { contentType: arquivo.type, upsert: false });
  if (error) throw new Error("Não foi possível enviar o anexo. Tente novamente.");
  return path;
}
