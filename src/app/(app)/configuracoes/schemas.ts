import { z } from "zod";
import {
  erroDeIntervalos,
  HORA_REGEX,
  NOME_DIA,
} from "@/lib/dominio/intervalos";
import { telefoneOpcional, textoOpcional } from "@/lib/validacao";
import { ROTULO_TIPO_MENSAGEM, type TipoMensagem } from "@/lib/dominio/whatsapp";

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
  onlineAtivo: z.boolean().default(false),
  onlineAntecedenciaMinHoras: z
    .number("Informe a antecedência mínima em horas.")
    .int("A antecedência mínima deve ser um número inteiro.")
    .min(0, "A antecedência mínima não pode ser negativa.")
    .max(72, "A antecedência mínima pode ser de no máximo 72 horas."),
  onlineAntecedenciaMaxDias: z
    .number("Informe a antecedência máxima em dias.")
    .int("A antecedência máxima deve ser um número inteiro.")
    .min(1, "A antecedência máxima deve ser de pelo menos 1 dia.")
    .max(180, "A antecedência máxima pode ser de no máximo 180 dias."),
  onlineAvisoPrivacidade: z
    .string()
    .trim()
    .min(20, "O aviso de privacidade deve ter pelo menos 20 caracteres.")
    .max(1000, "O aviso de privacidade pode ter no máximo 1000 caracteres."),
});

export type ConfiguracoesInput = z.input<typeof configuracoesSchema>;

export const whatsappConfigSchema = z
  .object({
    ativo: z.boolean(),
    janelaInicio: z.string().regex(HORA_REGEX, "Use horas no formato HH:mm."),
    janelaFim: z.string().regex(HORA_REGEX, "Use horas no formato HH:mm."),
    limitePorHora: z
      .number("Informe o limite por hora.")
      .int("O limite por hora deve ser um número inteiro.")
      .min(1, "O limite por hora deve ser de pelo menos 1.")
      .max(200, "O limite por hora pode ser de no máximo 200."),
  })
  .refine((v) => v.janelaFim > v.janelaInicio, {
    path: ["janelaFim"],
    message: "O fim da janela deve ser depois do início.",
  });

export type WhatsappConfigInput = z.input<typeof whatsappConfigSchema>;

export type TipoModelo = Exclude<TipoMensagem, "avulsa">;

/** Tipos com modelo editável: todos menos avulsa (o texto já vem pronto). */
export const TIPOS_MODELO = Object.keys(ROTULO_TIPO_MENSAGEM).filter(
  (t): t is TipoModelo => t !== "avulsa",
) as [TipoModelo, ...TipoModelo[]];

export const modeloSchema = z.object({
  tipo: z.enum(TIPOS_MODELO),
  variacoes: z
    .array(
      z
        .string()
        .trim()
        .min(1, "Nenhuma variação pode ficar vazia.")
        .max(1000, "Cada variação pode ter no máximo 1000 caracteres."),
    )
    .min(1, "Mantenha pelo menos 1 variação.")
    .max(5, "Use no máximo 5 variações."),
  ativo: z.boolean(),
});

export type ModeloInput = z.input<typeof modeloSchema>;
