import { TZDate } from "@date-fns/tz";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

/** Fuso fixo da clínica, independente do fuso do aparelho. */
export const FUSO = "America/Sao_Paulo";

/**
 * Entradas em string devem trazer fuso explícito (ex.: "2026-11-04T02:30:00Z"),
 * como o timestamptz do Postgres devolve. Sem fuso, o JS usa o fuso do aparelho.
 */
function noFuso(instante: Date | string): TZDate {
  return new TZDate(new Date(instante).getTime(), FUSO);
}

const DATA = /^(\d{4})-(\d{2})-(\d{2})$/;
const HORA = /^(\d{2}):(\d{2})$/;

/** ("2026-11-03", "09:00") -> instante correspondente às 09:00 em São Paulo. */
export function combinarDataHora(data: string, hora: string): Date {
  const d = DATA.exec(data);
  const h = HORA.exec(hora);
  if (!d || !h) {
    throw new RangeError(`Data ou hora inválida: ${data} ${hora}`);
  }

  const [ano, mes, dia, horas, minutos] = [d[1], d[2], d[3], h[1], h[2]].map(Number);
  const instante = new TZDate(ano, mes - 1, dia, horas, minutos, 0, 0, FUSO);

  // O JS rola datas impossíveis (30/02, 25:00) para outro dia. Isso não pode
  // virar agendamento silencioso, então conferimos os campos de volta.
  const confere =
    instante.getFullYear() === ano &&
    instante.getMonth() === mes - 1 &&
    instante.getDate() === dia &&
    instante.getHours() === horas &&
    instante.getMinutes() === minutos;
  if (!confere || Number.isNaN(instante.getTime())) {
    throw new RangeError(`Data ou hora inválida: ${data} ${hora}`);
  }
  return new Date(instante.getTime());
}

/** Formata o instante no fuso de São Paulo com padrão date-fns (pt-BR). */
export function formatarNoFuso(instante: Date | string, padrao: string): string {
  return format(noFuso(instante), padrao, { locale: ptBR });
}

/** Data de São Paulo no formato yyyy-MM-dd. */
export function dataNoFuso(instante: Date | string): string {
  return formatarNoFuso(instante, "yyyy-MM-dd");
}

/** Dia da semana em São Paulo (0 = domingo). */
export function diaDaSemanaNoFuso(instante: Date | string): number {
  return noFuso(instante).getDay();
}

/** Hora de São Paulo no formato HH:mm. */
export function horaNoFuso(instante: Date | string): string {
  return formatarNoFuso(instante, "HH:mm");
}
