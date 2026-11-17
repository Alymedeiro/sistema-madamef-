// Fotos dos serviços (0020): regras puras usadas no cadastro e no /agendar.
import { dimensoesAlvo } from "./fotos";

/** Bucket público do Storage com as fotos do catálogo. */
export const BUCKET_SERVICOS_FOTOS = "servicos-fotos";
export const MAX_FOTOS_SERVICO = 5;
/** Maior lado, em pixels, depois de redimensionar no navegador. */
export const MAX_LADO_FOTO_SERVICO = 1600;
/** Maior original aceito (antes de redimensionar). */
export const MAX_BYTES_ORIGINAL_FOTO_SERVICO = 10 * 1024 * 1024;
/** Limite do bucket (2 MB) para o arquivo já comprimido. */
export const MAX_BYTES_FOTO_SERVICO = 2 * 1024 * 1024;
export const QUALIDADE_FOTO_SERVICO = 0.82;

export const MENSAGEM_NAO_IMAGEM = "Escolha um arquivo de imagem (JPEG, PNG ou WebP).";
export const MENSAGEM_ORIGINAL_GRANDE = "A foto é grande demais (máximo 10 MB). Escolha outra.";
export const MENSAGEM_FOTO_SERVICO_ILEGIVEL =
  "Não foi possível ler esta foto. Tente outra imagem.";
export const MENSAGEM_LIMITE_FOTOS = `Cada serviço pode ter no máximo ${MAX_FOTOS_SERVICO} fotos.`;

/** Mensagem de recusa do arquivo escolhido, ou null se pode seguir para o redimensionamento. */
export function validarArquivoFotoServico(a: { type: string; size: number }): string | null {
  if (!a.type.trim().toLowerCase().startsWith("image/")) return MENSAGEM_NAO_IMAGEM;
  if (a.size > MAX_BYTES_ORIGINAL_FOTO_SERVICO) return MENSAGEM_ORIGINAL_GRANDE;
  return null;
}

/** Cabe em 1600 px no maior lado, mantendo a proporção; nunca amplia. */
export function dimensoesFotoServico(largura: number, altura: number) {
  return dimensoesAlvo(largura, altura, MAX_LADO_FOTO_SERVICO);
}

export type ExtensaoFotoServico = "webp" | "jpg";

/** Caminho no bucket: servicos/<servico_id>/<uuid>.<ext> (o banco confere o formato). */
export function caminhoFotoServico(servicoId: string, id: string, ext: ExtensaoFotoServico): string {
  return `servicos/${servicoId}/${id}.${ext}`;
}

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

export function caminhoFotoServicoValido(servicoId: string, caminho: string): boolean {
  return new RegExp(`^servicos/${servicoId}/${UUID}\\.(webp|jpg)$`).test(caminho);
}

/** Quantas fotos ainda cabem no serviço. */
export function vagasFotos(atuais: number): number {
  return Math.max(0, MAX_FOTOS_SERVICO - atuais);
}

export function rotuloContagemFotos(n: number): string {
  return `${n} de ${MAX_FOTOS_SERVICO} fotos`;
}

/** Nova ordem com a foto `id` na posição 0 (capa); as demais mantêm a ordem relativa. */
export function ordemComCapa(ids: string[], id: string): string[] {
  if (!ids.includes(id)) return ids;
  return [id, ...ids.filter((x) => x !== id)];
}

/** Nova ordem trocando a foto `id` com a vizinha (-1 = esquerda, 1 = direita). */
export function ordemMovida(ids: string[], id: string, direcao: -1 | 1): string[] {
  const i = ids.indexOf(id);
  const j = i + direcao;
  if (i < 0 || j < 0 || j >= ids.length) return ids;
  const nova = [...ids];
  [nova[i], nova[j]] = [nova[j], nova[i]];
  return nova;
}

/**
 * Exporta a imagem: WebP na qualidade padrão; se o navegador não gerar WebP
 * (blob nulo ou de outro tipo), JPEG. Arquivo final acima de 2 MB é recusado.
 */
export async function exportarFotoServico(
  gerar: (tipo: "image/webp" | "image/jpeg", qualidade: number) => Promise<Blob | null>,
): Promise<{ blob: Blob; ext: ExtensaoFotoServico; contentType: string }> {
  const webp = await gerar("image/webp", QUALIDADE_FOTO_SERVICO);
  let saida: { blob: Blob; ext: ExtensaoFotoServico; contentType: string } | null =
    webp && webp.type === "image/webp"
      ? { blob: webp, ext: "webp", contentType: "image/webp" }
      : null;
  if (!saida) {
    const jpeg = await gerar("image/jpeg", QUALIDADE_FOTO_SERVICO);
    if (!jpeg) throw new Error(MENSAGEM_FOTO_SERVICO_ILEGIVEL);
    saida = { blob: jpeg, ext: "jpg", contentType: "image/jpeg" };
  }
  if (saida.blob.size > MAX_BYTES_FOTO_SERVICO) {
    throw new Error("A foto ficou grande demais mesmo reduzida. Escolha outra.");
  }
  return saida;
}

export type FotoPublica = { url: string; largura: number | null; altura: number | null };

/**
 * Agrupa as linhas de servicos_fotos por serviço, na ordem (capa primeiro),
 * já com a URL pública montada por `urlDe`.
 */
export function fotosPorServico(
  linhas: { servico_id: string; caminho: string; ordem: number; largura: number | null; altura: number | null }[],
  urlDe: (caminho: string) => string,
): Map<string, FotoPublica[]> {
  const mapa = new Map<string, FotoPublica[]>();
  for (const l of [...linhas].sort((a, b) => a.ordem - b.ordem)) {
    const lista = mapa.get(l.servico_id) ?? [];
    lista.push({ url: urlDe(l.caminho), largura: l.largura, altura: l.altura });
    mapa.set(l.servico_id, lista);
  }
  return mapa;
}
