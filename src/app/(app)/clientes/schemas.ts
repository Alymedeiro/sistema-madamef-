import { z } from "zod";
import { limparCPF, validarCPF } from "@/lib/dominio/cpf";
import { normalizarWhatsApp } from "@/lib/dominio/telefone";
import { dataNoFuso } from "@/lib/dominio/tempo";
import { textoOpcional } from "@/lib/validacao";

export const ORIGENS_CLIENTE = [
  "instagram",
  "indicacao",
  "google",
  "passou_na_frente",
  "outro",
] as const;
export type OrigemCliente = (typeof ORIGENS_CLIENTE)[number];

export const ROTULO_ORIGEM: Record<OrigemCliente, string> = {
  instagram: "Instagram",
  indicacao: "Indicação",
  google: "Google",
  passou_na_frente: "Passou na frente",
  outro: "Outro",
};

export const MSG_LGPD = "É preciso o aceite da cliente (LGPD)";

const whatsappOpcional = z
  .string()
  .trim()
  .optional()
  .transform((v, ctx) => {
    if (!v) return null;
    const normalizado = normalizarWhatsApp(v);
    if (!normalizado) {
      ctx.addIssue({ code: "custom", message: "Informe o WhatsApp com DDD" });
      return z.NEVER;
    }
    return normalizado;
  });

/** CPF opcional: só dígitos depois de validado. Também é a chave contra duplicidade. */
const cpfOpcional = z
  .string()
  .trim()
  .optional()
  .transform((v, ctx) => {
    if (!v) return null;
    if (!validarCPF(v)) {
      ctx.addIssue({ code: "custom", message: "CPF inválido" });
      return z.NEVER;
    }
    return limparCPF(v);
  });

const emailOpcional = z
  .string()
  .trim()
  .max(160, "O e-mail pode ter no máximo 160 caracteres.")
  .optional()
  .transform((v, ctx) => {
    if (!v) return null;
    if (!z.email().safeParse(v).success) {
      ctx.addIssue({ code: "custom", message: "E-mail inválido." });
      return z.NEVER;
    }
    return v.toLowerCase();
  });

const MSG_DATA = "Data de nascimento inválida.";
const dataNascimentoOpcional = z
  .string()
  .trim()
  .optional()
  .transform((v, ctx) => {
    if (!v) return null;
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
    let valida = false;
    if (m) {
      const [ano, mes, dia] = [Number(m[1]), Number(m[2]), Number(m[3])];
      const d = new Date(Date.UTC(ano, mes - 1, dia));
      // Rejeita datas que o JS "rola" (31/02), anteriores a 1900 e futuras.
      valida =
        d.getUTCFullYear() === ano &&
        d.getUTCMonth() === mes - 1 &&
        d.getUTCDate() === dia &&
        ano >= 1900 &&
        v <= dataNoFuso(new Date());
    }
    if (!valida) {
      ctx.addIssue({ code: "custom", message: MSG_DATA });
      return z.NEVER;
    }
    return v;
  });

const origemOpcional = z
  .union([z.literal(""), z.enum(ORIGENS_CLIENTE, "Origem inválida.")], "Origem inválida.")
  .optional()
  .transform((v) => (v ? v : null));

const camposCliente = {
  nome: z
    .string()
    .trim()
    .min(1, "Informe o nome da cliente.")
    .max(120, "O nome pode ter no máximo 120 caracteres.")
    .transform((v) => v.replace(/\s+/g, " ")),
  whatsapp: whatsappOpcional,
  cpf: cpfOpcional,
  email: emailOpcional,
  dataNascimento: dataNascimentoOpcional,
  endereco: textoOpcional(200, "O endereço pode ter no máximo 200 caracteres."),
  origem: origemOpcional,
  observacoes: textoOpcional(2000, "As observações podem ter no máximo 2000 caracteres."),
  aceitaWhatsappMarketing: z.boolean().optional().default(false),
};

/** Edição: o aceite LGPD é registrado uma vez, no cadastro, e nunca é alterado depois. */
export const clienteAtualizacaoSchema = z.object(camposCliente);

/** Cadastro: exige o aceite LGPD da cliente. */
export const clienteSchema = z.object({
  ...camposCliente,
  aceiteLgpd: z.boolean(MSG_LGPD).refine((v) => v === true, MSG_LGPD),
});

export type ClienteInput = z.input<typeof clienteSchema>;
export type ClienteAtualizacaoInput = z.input<typeof clienteAtualizacaoSchema>;
