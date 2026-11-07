/**
 * Roda `acao` e, dê certo ou não, limpa o progresso no fim: um erro de rede ou
 * da action não deixa a tela presa em "Enviando…".
 */
export async function comProgresso(
  definir: (texto: string | null) => void,
  acao: () => Promise<void>,
): Promise<void> {
  try {
    await acao();
  } finally {
    definir(null);
  }
}
