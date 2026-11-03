// Intervalos de horário do dia (jornada da profissional e horário de
// funcionamento da clínica). Horas sempre "HH:mm" (sem fuso: é hora de parede
// de São Paulo).

export type Intervalo = { inicio: string; fim: string };
export type JornadaLinha = { diaSemana: number; horaInicio: string; horaFim: string };
export type DiaChave = "0" | "1" | "2" | "3" | "4" | "5" | "6";
export type IntervalosPorDia = Record<DiaChave, Intervalo[]>;

/** 0..6 -> "0".."6" (chave do horário de funcionamento). */
export function chaveDia(dia: number): DiaChave {
  return String(dia) as DiaChave;
}

export const HORA_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Ordem de exibição: segunda a domingo (0 = domingo no banco). */
export const ORDEM_DIAS = [1, 2, 3, 4, 5, 6, 0] as const;

export const NOME_DIA: Record<number, string> = {
  0: "Domingo",
  1: "Segunda-feira",
  2: "Terça-feira",
  3: "Quarta-feira",
  4: "Quinta-feira",
  5: "Sexta-feira",
  6: "Sábado",
};

/**
 * Valida os intervalos de UM dia. Devolve a mensagem do primeiro problema ou
 * null. Intervalos que apenas se encostam (12:00 fim / 12:00 início) são válidos.
 */
export function erroDeIntervalos(intervalos: readonly Intervalo[]): string | null {
  for (const i of intervalos) {
    if (!HORA_REGEX.test(i.inicio) || !HORA_REGEX.test(i.fim)) {
      return "Use horas no formato HH:mm.";
    }
    // "HH:mm" com zero à esquerda compara corretamente como texto.
    if (i.fim <= i.inicio) return "O horário final deve ser depois do inicial.";
  }
  const ordenados = [...intervalos].sort((a, b) => a.inicio.localeCompare(b.inicio));
  for (let k = 1; k < ordenados.length; k++) {
    if (ordenados[k].inicio < ordenados[k - 1].fim) {
      return "Os intervalos do mesmo dia não podem se sobrepor.";
    }
  }
  return null;
}

/** "09:00:00" (Postgres time) -> "09:00". */
export function horaCurta(hora: string): string {
  return hora.slice(0, 5);
}

/** Linhas planas de `jornadas` -> { "0": [...], ..., "6": [...] }, ordenado por início. */
export function agruparJornadasPorDia(linhas: readonly JornadaLinha[]): IntervalosPorDia {
  const porDia: IntervalosPorDia = { "0": [], "1": [], "2": [], "3": [], "4": [], "5": [], "6": [] };
  for (const l of linhas) {
    porDia[chaveDia(l.diaSemana)]?.push({
      inicio: horaCurta(l.horaInicio),
      fim: horaCurta(l.horaFim),
    });
  }
  for (const lista of Object.values(porDia)) {
    lista.sort((a, b) => a.inicio.localeCompare(b.inicio));
  }
  return porDia;
}

/** Inverso de agruparJornadasPorDia. */
export function achatarJornadasPorDia(porDia: IntervalosPorDia): JornadaLinha[] {
  const linhas: JornadaLinha[] = [];
  for (const d of ORDEM_DIAS) {
    for (const i of porDia[chaveDia(d)] ?? []) {
      linhas.push({ diaSemana: d, horaInicio: i.inicio, horaFim: i.fim });
    }
  }
  return linhas;
}

/** Lê o jsonb `horario_funcionamento` de forma tolerante: dia ausente ou malformado = fechado. */
export function horarioDoBanco(json: unknown): IntervalosPorDia {
  const porDia: IntervalosPorDia = { "0": [], "1": [], "2": [], "3": [], "4": [], "5": [], "6": [] };
  if (!json || typeof json !== "object" || Array.isArray(json)) return porDia;
  const bruto = json as Record<string, unknown>;
  for (const d of ORDEM_DIAS) {
    const lista = bruto[String(d)];
    if (!Array.isArray(lista)) continue;
    for (const item of lista) {
      if (
        item &&
        typeof item === "object" &&
        typeof (item as Intervalo).inicio === "string" &&
        typeof (item as Intervalo).fim === "string"
      ) {
        porDia[chaveDia(d)].push({
          inicio: horaCurta((item as Intervalo).inicio),
          fim: horaCurta((item as Intervalo).fim),
        });
      }
    }
    porDia[chaveDia(d)].sort((a, b) => a.inicio.localeCompare(b.inicio));
  }
  return porDia;
}
