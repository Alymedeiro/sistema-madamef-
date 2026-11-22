// O que a página /agendar entrega ao navegador: nada além disso.

import { formatarBRL } from "@/lib/dominio/dinheiro";
import type { FotoPublica } from "@/lib/dominio/servicos-fotos";

export type ServicoOnline = {
  id: string;
  nome: string;
  descricao: string | null;
  duracaoMin: number;
  /** Preço de tabela; 0 aparece como "Valor sob consulta". */
  precoCentavos: number;
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

export function precoServico(s: Pick<ServicoOnline, "precoCentavos">): string {
  return s.precoCentavos > 0 ? formatarBRL(s.precoCentavos) : "Valor sob consulta";
}
