// Regras puras do painel do Início (sem acesso a dados): comparações, séries e alertas.

import { dataNoFuso } from "@/lib/dominio/tempo";
import { somarDias } from "./painel";

/** Variação % inteira de `atual` sobre `base`; sem base positiva não há comparação (null). */
export function variacaoPercentual(atual: number, base: number): number | null {
  if (!(base > 0)) return null;
  return Math.round(((atual - base) / base) * 100);
}

/** Faturamento ÷ atendidos (centavos, arredondado); sem atendidos, null ("—"). */
export function ticketMedio(faturamentoCentavos: number, atendidos: number): number | null {
  if (atendidos <= 0) return null;
  return Math.round(faturamentoCentavos / atendidos);
}

/** Primeiro atendimento não cancelado com início a partir de `agora`. */
export function proximoAtendimento<T extends { inicio: string; status: string }>(
  itens: T[],
  agora: Date,
): T | null {
  const t = agora.getTime();
  return (
    [...itens]
      .filter((i) => i.status !== "cancelado" && new Date(i.inicio).getTime() >= t)
      .sort((a, b) => new Date(a.inicio).getTime() - new Date(b.inicio).getTime())[0] ?? null
  );
}

export type EntradaAlerta = {
  id: string;
  contagem: number;
  singular: string;
  plural: string;
  href: string;
  /** Texto sem o número na frente (ex.: "WhatsApp desconectado"). */
  semNumero?: boolean;
};
export type Alerta = { id: string; texto: string; href: string };

/** Só os alertas com contagem > 0, cada um como "N rótulo". */
export function montarAlertas(entradas: EntradaAlerta[]): Alerta[] {
  return entradas
    .filter((e) => e.contagem > 0)
    .map((e) => {
      const rotulo = e.contagem === 1 ? e.singular : e.plural;
      return { id: e.id, texto: e.semNumero ? rotulo : `${e.contagem} ${rotulo}`, href: e.href };
    });
}

export type PontoDia = { dia: string; valor: number };

/** Um ponto por dia de `de` a `ate` (inclusive); dias sem movimento valem 0. */
export function serieDiaria(linhas: PontoDia[], de: string, ate: string): PontoDia[] {
  const porDia = new Map<string, number>();
  for (const l of linhas) porDia.set(l.dia, (porDia.get(l.dia) ?? 0) + l.valor);
  const serie: PontoDia[] = [];
  for (let d = de; d <= ate; d = somarDias(d, 1)) serie.push({ dia: d, valor: porDia.get(d) ?? 0 });
  return serie;
}

/** Segunda a domingo da semana de `hoje` (yyyy-MM-dd). */
export function semanaSegDom(hoje: string): string[] {
  const dow = new Date(`${hoje}T00:00:00Z`).getUTCDay(); // 0 = domingo
  const segunda = somarDias(hoje, -((dow + 6) % 7));
  return Array.from({ length: 7 }, (_, i) => somarDias(segunda, i));
}

/** Início do mês, início do mês anterior e o mesmo dia do mês anterior (limitado ao último dia). */
export function periodosDoMes(hoje: string): {
  inicioMes: string;
  inicioMesAnterior: string;
  fimMesAnterior: string;
} {
  const ano = Number(hoje.slice(0, 4));
  const mes = Number(hoje.slice(5, 7));
  const dia = Number(hoje.slice(8, 10));
  const anoAnt = mes === 1 ? ano - 1 : ano;
  const mesAnt = mes === 1 ? 12 : mes - 1;
  const ultimo = new Date(Date.UTC(anoAnt, mesAnt, 0)).getUTCDate();
  const dois = (n: number) => String(n).padStart(2, "0");
  return {
    inicioMes: `${ano}-${dois(mes)}-01`,
    inicioMesAnterior: `${anoAnt}-${dois(mesAnt)}-01`,
    fimMesAnterior: `${anoAnt}-${dois(mesAnt)}-${dois(Math.min(dia, ultimo))}`,
  };
}

/** Soma dos valores dos pontos de `de` a `ate` (inclusive). */
export function somarPeriodo(linhas: PontoDia[], de: string, ate: string): number {
  return linhas.filter((l) => l.dia >= de && l.dia <= ate).reduce((s, l) => s + l.valor, 0);
}

/** Quantos instantes caem em cada dia de São Paulo de `dias` (mesma ordem). */
export function atendimentosPorDia(inicios: string[], dias: string[]): number[] {
  const conta = new Map<string, number>();
  for (const i of inicios) {
    const d = dataNoFuso(i);
    conta.set(d, (conta.get(d) ?? 0) + 1);
  }
  return dias.map((d) => conta.get(d) ?? 0);
}
