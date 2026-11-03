import { z } from "zod";
import {
  erroDeIntervalos,
  HORA_REGEX,
  NOME_DIA,
} from "@/lib/dominio/intervalos";
import { telefoneOpcional, textoOpcional } from "@/lib/validacao";

const hora = z.string().regex(HORA_REGEX, "Use horas no formato HH:mm.");
const intervalo = z.object({ inicio: hora, fim: hora });
const dia = z.array(intervalo);

/** Chaves "0" (domingo) a "6" (sábado); lista vazia = fechado. Mesmas regras de intervalo das jornadas. */
export const horarioFuncionamentoSchema = z
  .strictObject({
    "0": dia,
    "1": dia,
    "2": dia,
    "3": dia,
    "4": dia,
    "5": dia,
    "6": dia,
  })
  .superRefine((horario, ctx) => {
    for (const [chave, intervalos] of Object.entries(horario)) {
      const erro = erroDeIntervalos(intervalos);
      if (erro) {
        ctx.addIssue({
          code: "custom",
          message: `${NOME_DIA[Number(chave)]}: ${erro}`,
        });
      }
    }
  });

export const configuracoesSchema = z.object({
  nome: z
    .string()
    .trim()
    .min(1, "Informe o nome da clínica.")
    .max(120, "O nome pode ter no máximo 120 caracteres."),
  telefone: telefoneOpcional,
  endereco: textoOpcional(250, "O endereço pode ter no máximo 250 caracteres."),
  horarioFuncionamento: horarioFuncionamentoSchema,
});

export type ConfiguracoesInput = z.input<typeof configuracoesSchema>;
