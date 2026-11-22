import { z } from "zod";
import { novaSenhaSchema } from "@/app/definir-senha/schemas";

/** Trocar a senha pela tela de login: e-mail + senha atual + nova (duas vezes). */
export const trocarSenhaSchema = z
  .object({
    email: z.string().trim().min(1, "Informe o e-mail.").email("E-mail inválido."),
    atual: z.string().min(1, "Informe a senha atual."),
  })
  .and(novaSenhaSchema)
  .refine((v) => v.atual !== v.senha, {
    message: "A nova senha precisa ser diferente da atual.",
    path: ["senha"],
  });
