// Regras puras do CRM (Fase 5). Espelham as funções SQL da migração 0015 para
// poder ser testadas sem banco. Datas "yyyy-MM-dd" são dias de São Paulo.
import type { Database } from "@/lib/supabase/tipos";
import { aniversariantes } from "./aniversario";
import { dataNoFuso } from "./tempo";

export type EtapaLead = Database["public"]["Enums"]["etapa_lead"];

export const ETAPAS_LEAD: readonly EtapaLead[] = [
  "novo",
  "em_conversa",
  "orcamento_enviado",
  "agendou",
  "perdido",
];

export const ROTULO_ETAPA_LEAD: Record<EtapaLead, string> = {
  novo: "Novo",
  em_conversa: "Em conversa",
  orcamento_enviado: "Orçamento enviado",
  agendou: "Agendou",
  perdido: "Perdido",
};

/** Etapas em andamento (as duas restantes encerram o lead). */
export const ETAPAS_ABERTAS: readonly EtapaLead[] = ["novo", "em_conversa", "orcamento_enviado"];

const DIA_MS = 86_400_000;

function utc(data: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(data);
  if (!m) throw new RangeError(`Data inválida: ${data}`);
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/** Soma (ou subtrai) dias de calendário a uma data yyyy-MM-dd. */
export function somarDias(data: string, dias: number): string {
  return new Date(utc(data) + dias * DIA_MS).toISOString().slice(0, 10);
}

/** Dia do retorno: dia do atendimento em SP + dias_retorno do serviço. */
export function dataRetorno(inicioAtendimento: string | Date, diasRetorno: number): string {
  return somarDias(dataNoFuso(inicioAtendimento), diasRetorno);
}

/** Retorno com data anterior a hoje está atrasado; senão é da semana. */
export function situacaoRetorno(dataDoRetorno: string, hoje: string): "atrasado" | "semana" {
  return dataDoRetorno < hoje ? "atrasado" : "semana";
}

/** Dias de calendário (SP) entre o último atendimento e hoje. */
export function diasSemVir(ultimo: string | Date, hoje: string): number {
  return Math.round((utc(hoje) - utc(dataNoFuso(ultimo))) / DIA_MS);
}

/** Sumida: último atendimento há mais de `diasLimite` dias (sem atendimento: não). */
export function ehSumida(ultimo: string | Date | null, hoje: string, diasLimite: number): boolean {
  return ultimo !== null && diasSemVir(ultimo, hoje) > diasLimite;
}

/**
 * Quem faz aniversário entre `de` e `ate` (inclusive), por ordem de dia, com a
 * data do aniversário no período e a idade que faz. 29/02 vale 28/02 em ano comum.
 */
export function aniversariantesEntre<T extends { data_nascimento: string | null }>(
  clientes: T[],
  de: string,
  ate: string,
): (T & { dia: string; idade: number })[] {
  const itens = clientes.map((c) => ({ c, dataNascimento: c.data_nascimento }));
  const resultado: (T & { dia: string; idade: number })[] = [];
  for (let t = utc(de); t <= utc(ate); t += DIA_MS) {
    const dia = new Date(t).toISOString().slice(0, 10);
    for (const { c, dataNascimento } of aniversariantes(itens, dia, dia)) {
      resultado.push({
        ...c,
        dia,
        idade: Number(dia.slice(0, 4)) - Number((dataNascimento as string).slice(0, 4)),
      });
    }
  }
  return resultado;
}

/** Por que (ou se) dá para mandar WhatsApp de marketing a esta cliente. */
export type EnvioMarketing = "enviado" | "sem_whatsapp" | "sem_optin" | "livre";

export function classificarEnvio(c: {
  whatsapp: string | null;
  aceitaMarketing: boolean;
  enviadoEm?: string | null;
}): EnvioMarketing {
  if (c.enviadoEm) return "enviado";
  if (!c.whatsapp) return "sem_whatsapp";
  if (!c.aceitaMarketing) return "sem_optin";
  return "livre";
}
