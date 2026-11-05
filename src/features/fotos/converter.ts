import {
  MAX_BYTES_ENTRADA_FOTO,
  MAX_BYTES_FOTO,
  MENSAGEM_FOTO_GRANDE,
  MENSAGEM_FOTO_ILEGIVEL,
  QUALIDADES_JPEG,
  dimensoesAlvo,
  ehHeic,
} from "@/lib/dominio/fotos";

/** Só HEIC/HEIF passa pelo conversor pesado, e só se o navegador não decodificou sozinho. */
export function precisaConverterHeic(a: { type: string; name: string }): boolean {
  return ehHeic(a);
}

/**
 * Percorre as qualidades de `QUALIDADES_JPEG` até o JPEG gerado caber em
 * `MAX_BYTES_FOTO`. Sem blob ou sem caber em nenhuma: erro amigável.
 */
export async function comprimirAteCaber(
  gerar: (qualidade: number) => Promise<Blob | null>,
): Promise<Blob> {
  for (const q of QUALIDADES_JPEG) {
    const b = await gerar(q);
    if (!b) break;
    if (b.size <= MAX_BYTES_FOTO) return b;
  }
  throw new Error(MENSAGEM_FOTO_ILEGIVEL);
}

async function decodificar(arquivo: Blob): Promise<ImageBitmap> {
  // `imageOrientation: from-image` aplica a rotação EXIF das fotos de celular.
  return createImageBitmap(arquivo, { imageOrientation: "from-image" });
}

/**
 * Converte a foto escolhida em JPEG de no máximo 2560 px e 5 MB (navegador),
 * com fundo branco. Arquivo de entrada acima de 30 MB é recusado.
 * HEIC/HEIF que o navegador não abre é convertido com `heic2any` (carregado sob demanda).
 */
export async function converterParaJpeg(arquivo: File): Promise<Blob> {
  if (arquivo.size > MAX_BYTES_ENTRADA_FOTO) throw new Error(MENSAGEM_FOTO_GRANDE);
  let imagem: ImageBitmap;
  try {
    imagem = await decodificar(arquivo);
  } catch {
    if (!precisaConverterHeic(arquivo)) throw new Error(MENSAGEM_FOTO_ILEGIVEL);
    try {
      const { default: heic2any } = await import("heic2any");
      const saida = await heic2any({ blob: arquivo, toType: "image/jpeg", quality: 0.9 });
      imagem = await decodificar(Array.isArray(saida) ? saida[0] : saida);
    } catch {
      throw new Error(MENSAGEM_FOTO_ILEGIVEL);
    }
  }

  try {
    const { largura, altura } = dimensoesAlvo(imagem.width, imagem.height);
    const canvas = document.createElement("canvas");
    canvas.width = largura;
    canvas.height = altura;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error(MENSAGEM_FOTO_ILEGIVEL);
    // JPEG não tem transparência: sem fundo, o transparente de um PNG vira preto.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, largura, altura);
    ctx.drawImage(imagem, 0, 0, largura, altura);
    return await comprimirAteCaber(
      (q) => new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", q)),
    );
  } finally {
    imagem.close();
  }
}
