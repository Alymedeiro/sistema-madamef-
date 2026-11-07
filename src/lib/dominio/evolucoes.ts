export const JANELA_EDICAO_HORAS = 24;
export const MAX_TEXTO_EVOLUCAO = 5000;

/**
 * Só a autora edita, e só nas primeiras 24 h. Serve para mostrar ou esconder o
 * botão "Editar"; quem decide de verdade é `evolucoes_guarda` no banco (relógio do banco).
 */
export function podeEditarEvolucao(
  ev: { profissionalId: string; criadoEm: string },
  colaboradorId: string,
  agora: Date,
): boolean {
  if (ev.profissionalId !== colaboradorId) return false;
  const criado = new Date(ev.criadoEm).getTime();
  if (Number.isNaN(criado)) return false;
  return agora.getTime() <= criado + JANELA_EDICAO_HORAS * 3_600_000;
}
