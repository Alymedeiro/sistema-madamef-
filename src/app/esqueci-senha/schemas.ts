import { z } from "zod";

export const emailRecuperacaoSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email("Informe um e-mail válido."));

/** Resposta única, exista ou não a conta (sem enumeração de e-mails). */
export const MENSAGEM_NEUTRA =
  "Se este e-mail estiver cadastrado, você receberá um link para criar uma nova senha.";
