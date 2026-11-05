// Pacote no diálogo de agendamento: qual oferecer na caixa "Usar sessão do
// pacote" e o que enviar em `pacoteVendidoId` (undefined = não mexe; null =
// desvincula; id = vincula). O banco valida cliente, serviço e pacote ativo.

/** Agendamento em edição: pacote vinculado e com qual cliente/serviço foi salvo. */
export type PacoteOriginal = {
  pacoteId: string | null;
  clienteId: string;
  servicoId: string;
  /** Sessões que ainda restam no pacote vinculado (null se não há pacote). */
  restantes: number | null;
};

export type PacoteOferta = { id: string; restantes: number | null };

type Escolha = { original: PacoteOriginal | null; clienteId: string | undefined; servicoId: string };

/** O pacote vinculado continua valendo: mesma cliente e mesmo serviço do salvo. */
export function pacoteMantido({ original, clienteId, servicoId }: Escolha): boolean {
  return (
    !!original?.pacoteId && original.clienteId === clienteId && original.servicoId === servicoId
  );
}

/**
 * Pacote mostrado na caixa: na edição sem trocar cliente/serviço, o já
 * vinculado; senão o primeiro disponível para a cliente e o serviço atuais.
 */
export function pacoteOferecido(
  e: Escolha & { disponiveis: { id: string; restantes: number }[] },
): PacoteOferta | null {
  if (pacoteMantido(e)) return { id: e.original!.pacoteId!, restantes: e.original!.restantes };
  const p = e.disponiveis[0];
  return p ? { id: p.id, restantes: p.restantes } : null;
}

/** Valor de `pacoteVendidoId` a enviar. */
export function pacoteParaEnvio(
  e: Escolha & { oferecido: PacoteOferta | null; usar: boolean },
): string | null | undefined {
  if (pacoteMantido(e)) return e.usar ? undefined : null;
  if (e.oferecido && e.usar) return e.oferecido.id;
  // Pacote antigo de outra cliente/serviço (ou desmarcado): limpa.
  return e.original?.pacoteId ? null : undefined;
}
