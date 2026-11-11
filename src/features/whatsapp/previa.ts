import { addDays } from "date-fns";
import { renderizarMensagem } from "@/lib/dominio/whatsapp";
import { formatarNoFuso } from "@/lib/dominio/tempo";

/** Prévia de uma variação com dados de exemplo: Maria, amanhã 14:30, Limpeza de pele, Ana. */
export function previaMensagem(variacao: string, clinica: string, agora: Date = new Date()): string {
  return renderizarMensagem([variacao], {
    nome: "Maria",
    data: formatarNoFuso(addDays(agora, 1), "dd/MM"),
    hora: "14:30",
    servico: "Limpeza de pele",
    profissional: "Ana",
    clinica,
  });
}
