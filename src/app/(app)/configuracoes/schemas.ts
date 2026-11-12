import { z } from "zod";
import {
  erroDeIntervalos,
  HORA_REGEX,
  NOME_DIA,
} from "@/lib/dominio/intervalos";
import { telefoneOpcional, textoOpcional } from "@/lib/validacao";
import { MAX_OPCOES_ROBO } from "@/lib/dominio/robo";
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
  diasClienteSumida: z
    .number("Use um número entre 1 e 730.")
    .int("Use um número entre 1 e 730.")
    .min(1, "Use um número entre 1 e 730.")
    .max(730, "Use um número entre 1 e 730."),
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

export type TipoModelo = Exclude<TipoMensagem, "avulsa" | "robo">;

/** Tipos com modelo editável: todos menos avulsa e robô (o texto já vem pronto). */
export const TIPOS_MODELO = Object.keys(ROTULO_TIPO_MENSAGEM).filter(
  (t): t is TipoModelo => t !== "avulsa" && t !== "robo",
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

// Robô de atendimento (0017). Mesmos limites das restrições do banco.
const textoRobo = (rotulo: string) =>
  z
    .string()
    .trim()
    .min(1, `Escreva ${rotulo}.`)
    .max(1000, `${rotulo[0].toUpperCase()}${rotulo.slice(1)} pode ter no máximo 1000 caracteres.`);

export const opcaoRoboSchema = z
  .object({
    numero: z.number().int().min(1, "Use números de 1 a 8.").max(MAX_OPCOES_ROBO, "Use números de 1 a 8."),
    rotulo: z
      .string()
      .trim()
      .min(1, "Dê um nome para a opção.")
      .max(60, "O nome da opção pode ter no máximo 60 caracteres."),
    tipo: z.enum(["texto", "agendar_online", "falar_com_equipe"]),
    resposta: z
      .string()
      .trim()
      .max(1000, "A resposta pode ter no máximo 1000 caracteres.")
      .nullable()
      .transform((v) => (v ? v : null)),
    ativo: z.boolean(),
  })
  .refine((o) => o.tipo !== "texto" || !!o.resposta, {
    path: ["resposta"],
    message: "Escreva a resposta desta opção.",
  })
  .transform((o) => (o.tipo === "texto" ? o : { ...o, resposta: null }));

export const roboConfigSchema = z.object({
  ativo: z.boolean(),
  quando: z.enum(["sempre", "fora_do_horario"]),
  boasVindas: textoRobo("a mensagem de boas-vindas"),
  naoEntendi: textoRobo("a mensagem de 'não entendi'"),
  rodapeOpcao: z.string().trim().max(1000, "O rodapé pode ter no máximo 1000 caracteres."),
  linkAgendamento: z
    .string()
    .trim()
    .refine((v) => v === "" || /^https?:\/\/\S+$/.test(v), "Use um link começando com https://.")
    .transform((v) => (v === "" ? null : v)),
  opcoes: z
    .array(opcaoRoboSchema)
    .max(MAX_OPCOES_ROBO, `Use no máximo ${MAX_OPCOES_ROBO} opções.`)
    .refine((l) => new Set(l.map((o) => o.numero)).size === l.length, {
      message: "Cada opção precisa de um número diferente.",
    }),
});

export type RoboConfigInput = z.input<typeof roboConfigSchema>;
