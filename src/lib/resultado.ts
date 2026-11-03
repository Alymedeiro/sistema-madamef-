/** Retorno padrão das Server Actions: sucesso ou mensagem pt-BR para a usuária. */
export type Resultado = { ok: true } | { ok: false; erro: string };

export const OK: Resultado = { ok: true };

export function falha(erro: string): Resultado {
  return { ok: false, erro };
}

export const ERRO_INESPERADO = "Não foi possível concluir. Tente novamente.";
