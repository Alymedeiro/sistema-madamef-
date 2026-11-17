import {
  MENSAGEM_FOTO_SERVICO_ILEGIVEL,
  dimensoesFotoServico,
  exportarFotoServico,
  validarArquivoFotoServico,
  type ExtensaoFotoServico,
} from "@/lib/dominio/servicos-fotos";

export type FotoPreparada = {
  blob: Blob;
  ext: ExtensaoFotoServico;
  contentType: string;
  largura: number;
  altura: number;
};

/**
 * Navegador: confere o arquivo (imagem, até 10 MB), redimensiona com canvas
 * para no máximo 1600 px no maior lado e exporta WebP 0,82 (JPEG se o
 * navegador não gerar WebP). Erros saem com mensagem pronta para a usuária.
 */
export async function prepararFotoServico(arquivo: File): Promise<FotoPreparada> {
  const recusa = validarArquivoFotoServico(arquivo);
  if (recusa) throw new Error(recusa);

  let imagem: ImageBitmap;
  try {
    // `from-image` aplica a rotação EXIF das fotos de celular.
    imagem = await createImageBitmap(arquivo, { imageOrientation: "from-image" });
  } catch {
    throw new Error(MENSAGEM_FOTO_SERVICO_ILEGIVEL);
  }

  try {
    const { largura, altura } = dimensoesFotoServico(imagem.width, imagem.height);
    const canvas = document.createElement("canvas");
    canvas.width = largura;
    canvas.height = altura;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error(MENSAGEM_FOTO_SERVICO_ILEGIVEL);
    // Fundo branco: no fallback JPEG o transparente de um PNG viraria preto.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, largura, altura);
    ctx.drawImage(imagem, 0, 0, largura, altura);
    const saida = await exportarFotoServico(
      (tipo, q) => new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, tipo, q)),
    );
    return { ...saida, largura, altura };
  } finally {
    imagem.close();
  }
}
