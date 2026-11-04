import { z } from "zod";
import { dataValida } from "@/features/agenda/grade";
import { HORA_REGEX } from "@/lib/dominio/intervalos";
import type { StatusAgendamento } from "@/lib/dominio/status";
import { idSchema, textoOpcional } from "@/lib/validacao";

export const STATUS_AGENDAMENTO = [
  "pendente",
  "confirmado",
  "atendido",
  "faltou",
  "cancelado",
] as const satisfies readonly StatusAgendamento[];

export const dataSchema = z
  .string("Data inválida.")
  .refine((v) => dataValida(v), "Data inválida.");

export const horaSchema = z
  .string("Horário inválido.")
  .regex(HORA_REGEX, "Horário inválido.")
  .refine((v) => Number(v.slice(3, 5)) % 5 === 0, "Escolha um horário em intervalos de 5 minutos.");

export const agendamentoSchema = z.object({
  id: idSchema.optional(),
  clienteId: z.uuid("Escolha a cliente."),
  profissionalId: z.uuid("Escolha a profissional."),
  servicoId: z.uuid("Escolha o serviço."),
  data: dataSchema,
  hora: horaSchema,
  observacoes: textoOpcional(1000, "As observações podem ter no máximo 1000 caracteres."),
  forcarForaJornada: z.boolean().optional().default(false),
});

export type AgendamentoInput = z.input<typeof agendamentoSchema>;

export const remarcacaoSchema = z.object({
  id: idSchema,
  profissionalId: z.uuid("Escolha a profissional."),
  data: dataSchema,
  hora: horaSchema,
  forcarForaJornada: z.boolean().optional().default(false),
});

export const alteracaoStatusSchema = z.object({
  id: idSchema,
  para: z.enum(STATUS_AGENDAMENTO, "Status inválido."),
});
