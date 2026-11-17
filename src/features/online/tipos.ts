// O que a página /agendar entrega ao navegador: nada além disso.

import type { FotoPublica } from "@/lib/dominio/servicos-fotos";

export type ServicoOnline = {
  id: string;
  nome: string;
  descricao: string | null;
  duracaoMin: number;
  exigeAvaliacao: boolean;
  /** URLs públicas do bucket `servicos-fotos`, capa primeiro (pode ser vazia). */
  fotos: FotoPublica[];
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
