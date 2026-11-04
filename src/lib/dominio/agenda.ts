import { combinarDataHora, dataNoFuso, diaDaSemanaNoFuso } from "./tempo";
import type { StatusAgendamento } from "./status";

export type Intervalo = { inicio: Date; fim: Date };

export type ContextoAgenda = {
  jornadas: { diaSemana: number; horaInicio: string; horaFim: string }[];
  bloqueios: Intervalo[];
  agendamentos: (Intervalo & { id: string; status: StatusAgendamento })[];
  servicosDaProfissional: string[];
};

export type PropostaAgendamento = {
  id?: string;
  inicio: Date;
  duracaoMin: number;
  servicoId: string;
};

type ErroValidacao = "sobreposicao" | "bloqueio" | "servico_nao_realizado";
type AvisoValidacao = "fora_da_jornada";

export const MENSAGEM_VALIDACAO: Record<ErroValidacao | AvisoValidacao, string> = {
  sobreposicao: "Este horário já está ocupado para esta profissional.",
  bloqueio: "A profissional está de folga ou férias neste horário.",
  servico_nao_realizado: "Esta profissional não realiza este serviço.",
  fora_da_jornada: "Fora do horário de trabalho da profissional. Deseja encaixar mesmo assim?",
};

export function calcularFim(inicio: Date, duracaoMin: number): Date {
  if (!Number.isInteger(duracaoMin) || duracaoMin <= 0) {
    throw new RangeError(`Duração inválida: ${duracaoMin}`);
  }
  return new Date(inicio.getTime() + duracaoMin * 60_000);
}

/** Intervalos semiabertos [inicio, fim): encostar não é sobrepor. */
function sobrepoe(a: Intervalo, b: Intervalo): boolean {
  return a.inicio < b.fim && b.inicio < a.fim;
}

function cabeNaJornada(atendimento: Intervalo, jornadas: ContextoAgenda["jornadas"]): boolean {
  const dia = dataNoFuso(atendimento.inicio);
  // Atravessar a meia-noite de São Paulo nunca cabe em uma jornada.
  if (dataNoFuso(new Date(atendimento.fim.getTime() - 1)) !== dia) return false;
  const diaSemana = diaDaSemanaNoFuso(atendimento.inicio);
  return jornadas.some(
    (j) =>
      j.diaSemana === diaSemana &&
      combinarDataHora(dia, j.horaInicio) <= atendimento.inicio &&
      atendimento.fim <= combinarDataHora(dia, j.horaFim),
  );
}

export function validarAgendamento(
  p: PropostaAgendamento,
  ctx: ContextoAgenda,
): { erros: ErroValidacao[]; avisos: AvisoValidacao[] } {
  const atendimento: Intervalo = { inicio: p.inicio, fim: calcularFim(p.inicio, p.duracaoMin) };
  const erros: ErroValidacao[] = [];
  const avisos: AvisoValidacao[] = [];

  const ocupado = ctx.agendamentos.some(
    (a) => a.status !== "cancelado" && a.id !== p.id && sobrepoe(atendimento, a),
  );
  if (ocupado) erros.push("sobreposicao");
  if (ctx.bloqueios.some((b) => sobrepoe(atendimento, b))) erros.push("bloqueio");
  if (!ctx.servicosDaProfissional.includes(p.servicoId)) erros.push("servico_nao_realizado");
  if (!cabeNaJornada(atendimento, ctx.jornadas)) avisos.push("fora_da_jornada");

  return { erros, avisos };
}
