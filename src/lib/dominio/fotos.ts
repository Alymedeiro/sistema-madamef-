import { dataNoFuso } from "./tempo";

export type TipoFoto = "antes" | "depois" | "evolucao";

export const TIPOS_FOTO: readonly TipoFoto[] = ["antes", "depois", "evolucao"];

export const ROTULO_TIPO_FOTO: Record<TipoFoto, string> = {
  antes: "Antes",
  depois: "Depois",
  evolucao: "Evolução",
};

/** Maior lado, em pixels, da foto enviada. */
export const MAX_LADO_FOTO = 2560;
/** Tamanho máximo do JPEG enviado (igual ao limite do bucket). */
export const MAX_BYTES_FOTO = 5 * 1024 * 1024;
/** Maior arquivo aceito para conversão no navegador (decodificar mais que isso trava o celular). */
export const MAX_BYTES_ENTRADA_FOTO = 30 * 1024 * 1024;
export const MENSAGEM_FOTO_GRANDE = "A foto é grande demais (máximo 30 MB). Escolha outra foto.";
/** Qualidades tentadas, da melhor para a menor, até caber em `MAX_BYTES_FOTO`. */
export const QUALIDADES_JPEG = [0.85, 0.75, 0.65, 0.5];

export const MENSAGEM_ARQUIVO_RECUSADO = "Escolha uma foto (JPEG, PNG ou HEIC).";
export const MENSAGEM_FOTO_ILEGIVEL =
  "Não foi possível ler esta foto. Tente outra ou tire pela câmera.";

/** Reduz para caber em `maxLado` mantendo a proporção; nunca amplia. */
export function dimensoesAlvo(
  largura: number,
  altura: number,
  maxLado: number = MAX_LADO_FOTO,
): { largura: number; altura: number } {
  const maior = Math.max(largura, altura);
  if (maior <= maxLado) return { largura, altura };
  const fator = maxLado / maior;
  return {
    largura: Math.max(1, Math.round(largura * fator)),
    altura: Math.max(1, Math.round(altura * fator)),
  };
}

const TIPOS_ACEITOS = ["image/jpeg", "image/png", "image/heic", "image/heif"];
const EXTENSAO_ACEITA = /\.(jpe?g|png|heic|heif)$/i;

/** Aceita pelo tipo MIME; só olha a extensão quando o navegador não informa o tipo. */
export function arquivoDeImagemAceito(a: { type: string; name: string }): boolean {
  const tipo = a.type.trim().toLowerCase();
  if (tipo) return TIPOS_ACEITOS.includes(tipo);
  return EXTENSAO_ACEITA.test(a.name);
}

/** HEIC/HEIF (iPhone): o navegador costuma não decodificar. */
export function ehHeic(a: { type: string; name: string }): boolean {
  const tipo = a.type.trim().toLowerCase();
  return tipo === "image/heic" || tipo === "image/heif" || (!tipo && /\.(heic|heif)$/i.test(a.name));
}

/** Agrupa por dia (São Paulo, mais recente primeiro) e serviço; dentro do grupo, da mais antiga para a mais nova. */
export function agruparFotos<T extends { tiradaEm: string; servicoNome: string | null }>(
  fotos: T[],
): { data: string; servicoNome: string | null; fotos: T[] }[] {
  const grupos = new Map<string, { data: string; servicoNome: string | null; fotos: T[] }>();
  for (const f of [...fotos].sort((a, b) => Date.parse(a.tiradaEm) - Date.parse(b.tiradaEm))) {
    const data = dataNoFuso(f.tiradaEm);
    const chave = `${data}|${f.servicoNome ?? ""}`;
    const g = grupos.get(chave) ?? { data, servicoNome: f.servicoNome, fotos: [] };
    g.fotos.push(f);
    grupos.set(chave, g);
  }
  return [...grupos.values()].sort(
    (a, b) =>
      b.data.localeCompare(a.data) ||
      (a.servicoNome ?? "").localeCompare(b.servicoNome ?? "", "pt-BR"),
  );
}
