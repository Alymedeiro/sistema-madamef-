// Matemática pura da grade da agenda (sem React): linhas do dia, posição dos
// cartões, trechos fora da jornada e datas da navegação. Horas sempre de
// parede de São Paulo ("HH:mm"); instantes como Date.

import { combinarDataHora, dataNoFuso } from "@/lib/dominio/tempo";
import { horaCurta, type Intervalo } from "@/lib/dominio/intervalos";
import { idSchema } from "@/lib/validacao";

/** Passo das linhas da grade, em minutos. */
export const PASSO_MIN = 15;

export type Visao = "dia" | "semana";

function paraMinutos(hora: string): number {
  const [h, m] = horaCurta(hora).split(":").map(Number);
  return h * 60 + m;
}

function paraHora(minutos: number): string {
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * Linhas (hora de início de cada uma) do primeiro início ao último fim do
 * horário de funcionamento, de `passoMin` em `passoMin`. Dia fechado → [].
 */
export function linhasDoDia(horario: readonly Intervalo[], passoMin: number): string[] {
  if (horario.length === 0) return [];
  const inicio = Math.min(...horario.map((i) => paraMinutos(i.inicio)));
  const fim = Math.max(...horario.map((i) => paraMinutos(i.fim)));
  const primeira = Math.floor(inicio / passoMin) * passoMin;
  const linhas: string[] = [];
  for (let m = primeira; m < fim && m < 24 * 60; m += passoMin) linhas.push(paraHora(m));
  return linhas;
}

/** Hora em que a grade termina (fim da última linha). */
export function fimDaGrade(linhas: readonly string[], passoMin: number): string | null {
  const ultima = linhas.at(-1);
  if (!ultima) return null;
  return paraHora(paraMinutos(ultima) + passoMin);
}

/** Hora da linha `indice`, ou null fora da grade. */
export function horaDaLinha(linhas: readonly string[], indice: number): string | null {
  return linhas[indice] ?? null;
}

/** Linha (fracionária) em que uma hora "HH:mm" cai, relativa à primeira linha. */
export function linhaDaHora(hora: string, primeiraLinha: string, passoMin: number): number {
  return (paraMinutos(hora) - paraMinutos(primeiraLinha)) / passoMin;
}

/**
 * Topo e altura (em linhas) do intervalo [inicio, fim) na grade do dia `data`,
 * cortado nas bordas da grade. null se nada dele aparece.
 */
export function posicaoNaGrade(
  inicio: Date,
  fim: Date,
  data: string,
  linhas: readonly string[],
  passoMin: number,
): { topo: number; altura: number } | null {
  if (linhas.length === 0) return null;
  const origem = combinarDataHora(data, linhas[0]).getTime();
  const total = linhas.length;
  const topo = Math.max(0, (inicio.getTime() - origem) / 60_000 / passoMin);
  const base = Math.min(total, (fim.getTime() - origem) / 60_000 / passoMin);
  if (base <= topo) return null;
  return { topo, altura: base - topo };
}

/** Trechos de [inicioGrade, fimGrade) não cobertos pela jornada do dia. */
export function faixasForaDaJornada(
  jornadasDoDia: readonly Intervalo[],
  inicioGrade: string,
  fimGrade: string,
): Intervalo[] {
  const ordenadas = jornadasDoDia
    .map((j) => ({ inicio: paraMinutos(j.inicio), fim: paraMinutos(j.fim) }))
    .sort((a, b) => a.inicio - b.inicio);
  const faixas: Intervalo[] = [];
  let cursor = paraMinutos(inicioGrade);
  const limite = paraMinutos(fimGrade);
  for (const j of ordenadas) {
    if (j.inicio > cursor) faixas.push({ inicio: paraHora(cursor), fim: paraHora(Math.min(j.inicio, limite)) });
    cursor = Math.max(cursor, j.fim);
    if (cursor >= limite) break;
  }
  if (cursor < limite) faixas.push({ inicio: paraHora(cursor), fim: paraHora(limite) });
  return faixas.filter((f) => f.inicio < f.fim);
}

/**
 * Distribui itens sobrepostos lado a lado (ex.: um cancelado e o novo
 * agendamento no mesmo horário). Cada grupo de itens encadeados por
 * sobreposição divide a largura em `total` faixas.
 */
export function distribuirEmFaixas<T extends { id: string; inicio: Date; fim: Date }>(
  itens: readonly T[],
): Map<string, { faixa: number; total: number }> {
  const ordenados = [...itens].sort(
    (a, b) => a.inicio.getTime() - b.inicio.getTime() || a.fim.getTime() - b.fim.getTime(),
  );
  const resultado = new Map<string, { faixa: number; total: number }>();
  let grupo: { id: string; faixa: number }[] = [];
  let fimsDasFaixas: number[] = [];
  let fimDoGrupo = -Infinity;

  const fecharGrupo = () => {
    for (const g of grupo) resultado.set(g.id, { faixa: g.faixa, total: fimsDasFaixas.length });
    grupo = [];
    fimsDasFaixas = [];
  };

  for (const item of ordenados) {
    const ini = item.inicio.getTime();
    if (ini >= fimDoGrupo) {
      fecharGrupo();
      fimDoGrupo = -Infinity;
    }
    let faixa = fimsDasFaixas.findIndex((f) => f <= ini);
    if (faixa === -1) {
      faixa = fimsDasFaixas.length;
      fimsDasFaixas.push(item.fim.getTime());
    } else {
      fimsDasFaixas[faixa] = item.fim.getTime();
    }
    grupo.push({ id: item.id, faixa });
    fimDoGrupo = Math.max(fimDoGrupo, item.fim.getTime());
  }
  fecharGrupo();
  return resultado;
}

const DATA_REGEX = /^(\d{4})-(\d{2})-(\d{2})$/;

/** "yyyy-MM-dd" válida no calendário? */
export function dataValida(data: string): boolean {
  const m = DATA_REGEX.exec(data);
  if (!m) return false;
  const [ano, mes, dia] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const d = new Date(Date.UTC(ano, mes - 1, dia));
  return d.getUTCFullYear() === ano && d.getUTCMonth() === mes - 1 && d.getUTCDate() === dia;
}

/** Soma dias a uma data de calendário (sem fuso: é só aritmética de calendário). */
export function somarDias(data: string, dias: number): string {
  const [ano, mes, dia] = data.split("-").map(Number);
  const d = new Date(Date.UTC(ano, mes - 1, dia + dias));
  return d.toISOString().slice(0, 10);
}

/** Dia da semana (0 = domingo) de uma data de calendário. */
export function diaDaSemana(data: string): number {
  const [ano, mes, dia] = data.split("-").map(Number);
  return new Date(Date.UTC(ano, mes - 1, dia)).getUTCDay();
}

/** As 7 datas (segunda a domingo) da semana que contém `data`. */
export function semanaDe(data: string): string[] {
  const recuo = (diaDaSemana(data) + 6) % 7;
  const segunda = somarDias(data, -recuo);
  return Array.from({ length: 7 }, (_, i) => somarDias(segunda, i));
}

type Busca = Record<string, string | string[] | undefined>;

const unico = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

/** Lê ?data=&visao=&prof= de forma tolerante (inválido → padrão). */
export function parametrosAgenda(
  busca: Busca,
  hoje: string = dataNoFuso(new Date()),
): { data: string; visao: Visao; prof: string | null } {
  const data = unico(busca.data);
  const visao = unico(busca.visao);
  const prof = unico(busca.prof);
  return {
    data: data && dataValida(data) ? data : hoje,
    visao: visao === "semana" ? "semana" : "dia",
    prof: prof && idSchema.safeParse(prof).success ? prof : null,
  };
}

/** Endereço da agenda com os parâmetros da tela. */
export function hrefAgenda(p: { data: string; visao: Visao; prof?: string | null }): string {
  const busca = new URLSearchParams({ data: p.data, visao: p.visao });
  if (p.prof) busca.set("prof", p.prof);
  return `/agenda?${busca.toString()}`;
}

/** Data de destino das setas ‹ › (um dia ou uma semana). */
export function navegar(data: string, visao: Visao, sentido: 1 | -1): string {
  return somarDias(data, sentido * (visao === "semana" ? 7 : 1));
}

/** Identificador do horário livre usado como alvo do arrastar. */
export function idDoHorario(profissionalId: string, data: string, hora: string): string {
  return `horario|${profissionalId}|${data}|${hora}`;
}

export function lerIdDoHorario(
  id: string,
): { profissionalId: string; data: string; hora: string } | null {
  const partes = id.split("|");
  if (partes.length !== 4 || partes[0] !== "horario") return null;
  return { profissionalId: partes[1], data: partes[2], hora: partes[3] };
}
