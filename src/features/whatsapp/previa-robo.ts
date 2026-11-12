import { montarMenu, respostaOpcao, textoHorario, type OpcaoRobo } from "@/lib/dominio/robo";

/** Dados de exemplo da prévia: cliente Maria; clínica, endereço e horário reais. */
type DadosPrevia = { clinica: string; endereco: string; horario: unknown };

function dados(d: DadosPrevia) {
  return {
    nome: "Maria",
    clinica: d.clinica,
    endereco: d.endereco,
    horario: textoHorario(d.horario),
  };
}

/** Menu como a cliente Maria receberia (opções ativas em ordem). */
export function previaMenuRobo(
  boasVindas: string,
  opcoes: readonly OpcaoRobo[],
  d: DadosPrevia,
): string {
  return montarMenu(boasVindas, opcoes, dados(d));
}

/** Resposta de uma opção como a cliente Maria receberia. */
export function previaRespostaRobo(
  opcao: OpcaoRobo,
  rodape: string,
  link: string | null,
  d: DadosPrevia,
): string {
  return respostaOpcao(opcao, rodape, link, dados(d));
}
