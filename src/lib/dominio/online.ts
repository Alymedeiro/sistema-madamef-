import { z } from "zod";
import { PASSO_MIN } from "@/features/agenda/grade";
import { horaCurta, type JornadaLinha } from "./intervalos";
import { normalizarWhatsApp } from "./telefone";
import {
  combinarDataHora,
  dataNoFuso,
  diaDaSemanaNoFuso,
  formatarNoFuso,
} from "./tempo";

/** Quanto tempo um pedido "aguardando" segura o horário. */
export const RESERVA_HORAS = 24;

export type ContextoOnline = {
  agora: Date;
  /** yyyy-mm-dd em São Paulo. */
  dia: string;
  duracaoMin: number;
  antecedenciaMinHoras: number;
  antecedenciaMaxDias: number;
  /** Já filtradas (ativas e ligadas ao serviço). `ocupados` junta agendamentos
   * não cancelados, bloqueios e pedidos aguardando não vencidos. */
  profissionais: {
    id: string;
    nome: string;
    jornadas: JornadaLinha[];
    ocupados: { inicio: Date; fim: Date }[];
  }[];
};

const MIN_MS = 60_000;

/** Soma dias a um yyyy-mm-dd (calendário puro, sem fuso). */
function somarDias(dia: string, n: number): string {
  const [a, m, d] = dia.split("-").map(Number);
  return new Date(Date.UTC(a, m - 1, d + n)).toISOString().slice(0, 10);
}

/** De hoje (São Paulo) até hoje + max, inclusive. */
export function diasDisponiveis(agora: Date, antecedenciaMaxDias: number): string[] {
  const hoje = dataNoFuso(agora);
  return Array.from({ length: antecedenciaMaxDias + 1 }, (_, i) => somarDias(hoje, i));
}

/**
 * Gêmea de public.horarios_livres_online: grade de 15 min por intervalo da
 * jornada, início + duração <= fim do intervalo, início >= agora + antecedência,
 * dia em [hoje, hoje + max], sobreposição semiaberta. Um horário por instante,
 * com a primeira profissional livre por nome e depois id.
 */
export function horariosLivres(ctx: ContextoOnline): { inicio: Date; profissionalId: string }[] {
  const hoje = dataNoFuso(ctx.agora);
  if (ctx.dia < hoje || ctx.dia > somarDias(hoje, ctx.antecedenciaMaxDias)) return [];

  const minimo = ctx.agora.getTime() + ctx.antecedenciaMinHoras * 60 * MIN_MS;
  const duracao = ctx.duracaoMin * MIN_MS;
  const diaSemana = diaDaSemanaNoFuso(combinarDataHora(ctx.dia, "00:00"));
  const ordenadas = [...ctx.profissionais].sort(
    (a, b) => a.nome.localeCompare(b.nome, "pt-BR") || a.id.localeCompare(b.id),
  );

  const escolhido = new Map<number, string>();
  for (const prof of ordenadas) {
    for (const j of prof.jornadas) {
      if (j.diaSemana !== diaSemana) continue;
      const ini = combinarDataHora(ctx.dia, horaCurta(j.horaInicio)).getTime();
      const fim = combinarDataHora(ctx.dia, horaCurta(j.horaFim)).getTime();
      for (let t = ini; t + duracao <= fim; t += PASSO_MIN * MIN_MS) {
        if (t < minimo || escolhido.has(t)) continue;
        const sobrepoe = prof.ocupados.some(
          (o) => o.inicio.getTime() < t + duracao && t < o.fim.getTime(),
        );
        if (!sobrepoe) escolhido.set(t, prof.id);
      }
    }
  }

  return [...escolhido.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([t, profissionalId]) => ({ inicio: new Date(t), profissionalId }));
}

function primeiroNome(nome: string): string {
  return nome.trim().split(/\s+/)[0] ?? "";
}

export function mensagemAprovado(p: {
  nome: string;
  servico: string;
  profissional: string;
  inicio: Date;
}): string {
  const data = formatarNoFuso(p.inicio, "dd/MM");
  const hora = formatarNoFuso(p.inicio, "HH:mm");
  return `Oi, ${primeiroNome(p.nome)}! Seu horário de ${p.servico} com ${p.profissional} está confirmado para ${data} às ${hora}. Madame Fê Clinic`;
}

export function mensagemRecusado(p: { nome: string; servico: string; site: string }): string {
  return `Oi, ${primeiroNome(p.nome)}! Infelizmente o horário pedido para ${p.servico} não está disponível. Você pode escolher outro em ${p.site}/agendar ou responder esta mensagem.`;
}

export function linkWhatsApp(numero: string, texto: string): string {
  return `https://wa.me/${numero}?text=${encodeURIComponent(texto)}`;
}

export const pedidoSchema = z.object({
  servicoId: z.uuid("Registro inválido."),
  profissionalId: z.uuid("Registro inválido.").nullable(),
  inicio: z.iso.datetime({ offset: true, message: "Horário inválido." }),
  nome: z
    .string()
    .trim()
    .min(2, "Informe seu nome.")
    .max(80, "O nome pode ter no máximo 80 caracteres."),
  whatsapp: z.string().transform((v, ctx) => {
    const n = normalizarWhatsApp(v);
    if (!n) {
      ctx.addIssue({ code: "custom", message: "Informe um WhatsApp com DDD." });
      return z.NEVER;
    }
    return n;
  }),
  aceite: z.literal(true, "Aceite o aviso de privacidade para continuar."),
  token: z.string(),
});
