import { z } from "zod";
import { combinarDataHora } from "@/lib/dominio/tempo";
import {
  erroDeIntervalos,
  HORA_REGEX,
  NOME_DIA,
  type Intervalo,
} from "@/lib/dominio/intervalos";
import { telefoneOpcional, textoOpcional } from "@/lib/validacao";

export const PERFIS = ["dona", "recepcao", "profissional"] as const;

export const colaboradorSchema = z.object({
  nome: z
    .string()
    .trim()
    .min(1, "Informe o nome.")
    .max(120, "O nome pode ter no máximo 120 caracteres."),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .pipe(z.email("Informe um e-mail válido.")),
  funcao: textoOpcional(80, "A função pode ter no máximo 80 caracteres."),
  perfil: z.enum(PERFIS, "Escolha o perfil."),
  cor: z.string().regex(/^#[0-9A-Fa-f]{6}$/, "Use uma cor no formato #RRGGBB."),
  telefone: telefoneOpcional,
});

/** Na edição o e-mail não muda (é o login da pessoa). */
export const colaboradorEdicaoSchema = colaboradorSchema.omit({ email: true });

export type ColaboradorInput = z.input<typeof colaboradorSchema>;
export type ColaboradorEdicaoInput = z.input<typeof colaboradorEdicaoSchema>;

const horaSchema = z.string().regex(HORA_REGEX, "Use horas no formato HH:mm.");

export const jornadaItemSchema = z.object({
  diaSemana: z
    .number()
    .int("Dia da semana inválido.")
    .min(0, "Dia da semana inválido.")
    .max(6, "Dia da semana inválido."),
  horaInicio: horaSchema,
  horaFim: horaSchema,
});

export type JornadaInput = z.input<typeof jornadaItemSchema>;

/** Valida cada intervalo e a sobreposição entre intervalos do mesmo dia. */
export const jornadasSchema = z.array(jornadaItemSchema).superRefine((itens, ctx) => {
  const porDia = new Map<number, Intervalo[]>();
  for (const item of itens) {
    const lista = porDia.get(item.diaSemana) ?? [];
    lista.push({ inicio: item.horaInicio, fim: item.horaFim });
    porDia.set(item.diaSemana, lista);
  }
  for (const [dia, intervalos] of porDia) {
    const erro = erroDeIntervalos(intervalos);
    if (erro) {
      ctx.addIssue({ code: "custom", message: `${NOME_DIA[dia] ?? "Dia"}: ${erro}` });
    }
  }
});

// <input type="datetime-local"> entrega "yyyy-MM-ddTHH:mm" sem fuso.
const DATA_HORA_LOCAL = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/;

/** Folga/férias: horários digitados são de São Paulo; sai em ISO UTC. */
export const bloqueioSchema = z
  .object({
    inicio: z.string().regex(DATA_HORA_LOCAL, "Informe a data e a hora de início."),
    fim: z.string().regex(DATA_HORA_LOCAL, "Informe a data e a hora de fim."),
    motivo: z
      .string()
      .trim()
      .min(1, "Informe o motivo.")
      .max(200, "O motivo pode ter no máximo 200 caracteres."),
  })
  .transform((v, ctx) => {
    try {
      const [, dIni, hIni] = DATA_HORA_LOCAL.exec(v.inicio)!;
      const [, dFim, hFim] = DATA_HORA_LOCAL.exec(v.fim)!;
      const inicio = combinarDataHora(dIni, hIni);
      const fim = combinarDataHora(dFim, hFim);
      if (fim.getTime() <= inicio.getTime()) {
        ctx.addIssue({ code: "custom", message: "O fim deve ser depois do início." });
        return z.NEVER;
      }
      return { inicio: inicio.toISOString(), fim: fim.toISOString(), motivo: v.motivo };
    } catch {
      ctx.addIssue({ code: "custom", message: "Data ou hora inexistente." });
      return z.NEVER;
    }
  });

export type BloqueioInput = z.input<typeof bloqueioSchema>;

export const servicosDoColaboradorSchema = z
  .array(z.uuid("Serviço inválido."))
  .transform((ids) => [...new Set(ids)]);
