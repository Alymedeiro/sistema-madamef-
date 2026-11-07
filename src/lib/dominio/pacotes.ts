// Pacotes de sessões: regras puras (status efetivo, progresso, sugestão de valor).
// "hoje" é sempre a data de São Paulo no formato AAAA-MM-DD.

export type StatusPacote = "ativo" | "concluido" | "expirado" | "cancelado";

export const ROTULO_STATUS_PACOTE: Record<StatusPacote, string> = {
  ativo: "Ativo",
  concluido: "Concluído",
  expirado: "Expirado",
  cancelado: "Cancelado",
};

export const MAX_SESSOES = 50;

export type PacoteResumo = {
  id: string;
  servicoId: string;
  status: StatusPacote;
  validade: string | null;
  sessoesUsadas: number;
  totalSessoes: number;
};

/** Valor sugerido: preço do serviço vezes o número de sessões (editável na venda). */
export function sugestaoValorPacote(precoCentavos: number, sessoes: number): number {
  return precoCentavos * sessoes;
}

export function progressoPacote(
  usadas: number,
  total: number,
): { restantes: number; percentual: number } {
  const restantes = Math.max(total - usadas, 0);
  const percentual = total > 0 ? Math.round((usadas / total) * 100) : 0;
  return { restantes, percentual };
}

/**
 * Ativo com validade anterior a hoje e sessões restantes aparece como expirado
 * (o banco só grava isso em `expirar_pacotes`). A validade vale até o fim do dia.
 */
export function statusEfetivoPacote(p: PacoteResumo, hoje: string): StatusPacote {
  if (
    p.status === "ativo" &&
    p.validade !== null &&
    p.validade < hoje &&
    p.sessoesUsadas < p.totalSessoes
  ) {
    return "expirado";
  }
  return p.status;
}

export function pacoteUtilizavel(p: PacoteResumo, servicoId: string, hoje: string): boolean {
  return (
    p.servicoId === servicoId &&
    statusEfetivoPacote(p, hoje) === "ativo" &&
    p.sessoesUsadas < p.totalSessoes
  );
}
