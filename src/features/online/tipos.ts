// O que a página /agendar entrega ao navegador: nada além disso.

export type ServicoOnline = {
  id: string;
  nome: string;
  duracaoMin: number;
  exigeAvaliacao: boolean;
};

export type ProfissionalOnline = {
  id: string;
  /** Só o primeiro nome. */
  nome: string;
  servicoIds: string[];
};

export function rotuloServico(s: Pick<ServicoOnline, "nome" | "exigeAvaliacao">): string {
  return s.exigeAvaliacao ? `Agendar avaliação de ${s.nome}` : s.nome;
}
