// Busca de clientes: normalização do termo e classificação (nome × número).
// Puro e sem dependências, para testar sem banco e usar na tela e na action.

/** Mínimo de caracteres para buscar. */
export const MIN_CARACTERES_BUSCA = 2;
/** Dígitos a partir dos quais qualquer termo é tratado como número (telefone/CPF). */
export const MIN_DIGITOS_COM_LETRAS = 8;
/** Dígitos a partir dos quais um termo sem letras é tratado como pedaço de número. */
export const MIN_DIGITOS_SEM_LETRAS = 4;

/** Minúsculas, sem acento e com espaços simples — espelha public.normalizar_busca(). */
export function normalizarTextoBusca(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Escapa os curingas do LIKE (%, _ e a própria contrabarra) digitados pela usuária. */
export function escaparLike(texto: string): string {
  return texto.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export type TermoBusca =
  | { tipo: "vazia" }
  | { tipo: "nome"; texto: string }
  /** Variantes de dígitos a procurar (contém) em whatsapp e cpf. */
  | { tipo: "numero"; digitos: string[] };

/**
 * Decide como buscar:
 * - menos de 2 caracteres: não busca;
 * - 8+ dígitos (ou 4+ dígitos sem nenhuma letra): número. Descarta um 0 de
 *   tronco inicial ("011 9…") e, com 55 + 12–13 dígitos, tenta também sem o 55,
 *   porque o WhatsApp é gravado com 55 e a usuária costuma digitar sem;
 * - senão: nome sem acento.
 */
export function classificarTermoBusca(termo: string): TermoBusca {
  const limpo = termo.trim();
  if (limpo.length < MIN_CARACTERES_BUSCA) return { tipo: "vazia" };

  const digitos = limpo.replace(/\D/g, "");
  const temLetra = /\p{L}/u.test(limpo);
  const numerico =
    digitos.length >= MIN_DIGITOS_COM_LETRAS ||
    (!temLetra && digitos.length >= MIN_DIGITOS_SEM_LETRAS);

  if (!numerico) return { tipo: "nome", texto: normalizarTextoBusca(limpo) };

  const semTronco = digitos.startsWith("0") ? digitos.slice(1) : digitos;
  const variantes = [semTronco];
  if ((semTronco.length === 12 || semTronco.length === 13) && semTronco.startsWith("55")) {
    variantes.push(semTronco.slice(2));
  }
  return { tipo: "numero", digitos: variantes };
}
