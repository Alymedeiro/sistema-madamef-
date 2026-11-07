export const BUCKET_FICHA = "ficha-clinica";
export const URL_ASSINADA_SEGUNDOS = 300;

export type AreaArquivo = "anamneses" | "termos" | "fotos";

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
// Mesma regex de public.cliente_do_caminho (migração 0006).
const CAMINHO = new RegExp(
  `^clientes/(${UUID})/(anamneses|termos|fotos)/${UUID}\\.(jpg|png|pdf)$`,
);

export function caminhoArquivo(
  clienteId: string,
  area: AreaArquivo,
  id: string,
  ext: "png" | "pdf" | "jpg",
): string {
  return `clientes/${clienteId}/${area}/${id}.${ext}`;
}

export function caminhoPertence(
  caminho: string,
  clienteId: string,
  area: AreaArquivo,
): boolean {
  const m = CAMINHO.exec(caminho);
  return !!m && m[1] === clienteId.toLowerCase() && m[2] === area;
}
