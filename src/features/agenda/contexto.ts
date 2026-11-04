// Linhas do banco (PostgREST) → ContextoAgenda do domínio. O Postgres devolve
// `time` como "HH:mm:ss"; validarAgendamento exige "HH:mm", então normalizamos aqui.

import type { ContextoAgenda } from "@/lib/dominio/agenda";
import { horaCurta } from "@/lib/dominio/intervalos";
import type { StatusAgendamento } from "@/lib/dominio/status";
import { combinarDataHora } from "@/lib/dominio/tempo";
import { somarDias } from "./grade";

export type LinhaJornada = { dia_semana: number; hora_inicio: string; hora_fim: string };
export type LinhaIntervalo = { inicio: string; fim: string };
export type LinhaAgendamentoContexto = LinhaIntervalo & { id: string; status: StatusAgendamento };

/** [00:00, 24:00) do dia `data` em São Paulo. */
export function limitesDoDia(data: string): { inicio: Date; fim: Date } {
  return {
    inicio: combinarDataHora(data, "00:00"),
    fim: combinarDataHora(somarDias(data, 1), "00:00"),
  };
}

/**
 * Janela para buscar o que pode colidir com um atendimento do dia `data`:
 * o dia inteiro, estendido até o fim do atendimento se ele passar da meia-noite.
 */
export function janelaDeBusca(data: string, fimDoAtendimento: Date): { inicio: Date; fim: Date } {
  const dia = limitesDoDia(data);
  return {
    inicio: dia.inicio,
    fim: fimDoAtendimento > dia.fim ? fimDoAtendimento : dia.fim,
  };
}

export function montarContextoAgenda(linhas: {
  jornadas: readonly LinhaJornada[];
  bloqueios: readonly LinhaIntervalo[];
  agendamentos: readonly LinhaAgendamentoContexto[];
  servicoIds: readonly string[];
}): ContextoAgenda {
  return {
    jornadas: linhas.jornadas.map((j) => ({
      diaSemana: j.dia_semana,
      horaInicio: horaCurta(j.hora_inicio),
      horaFim: horaCurta(j.hora_fim),
    })),
    bloqueios: linhas.bloqueios.map((b) => ({ inicio: new Date(b.inicio), fim: new Date(b.fim) })),
    agendamentos: linhas.agendamentos.map((a) => ({
      id: a.id,
      status: a.status,
      inicio: new Date(a.inicio),
      fim: new Date(a.fim),
    })),
    servicosDaProfissional: [...linhas.servicoIds],
  };
}
