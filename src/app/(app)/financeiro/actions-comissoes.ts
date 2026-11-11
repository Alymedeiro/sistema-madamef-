"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { dataValida } from "@/features/agenda/grade";
import { FORMAS_SAIDA } from "@/lib/dominio/financeiro";
import { mensagemErroBanco } from "@/lib/erros-db";
import { ERRO_INESPERADO, type Resultado } from "@/lib/resultado";
import { exigirPerfil } from "@/lib/sessao";
import { createClient } from "@/lib/supabase/server";
import { dataSchema } from "./schemas";

const pagarComissoesSchema = z.object({
  profissionalId: z.uuid("Escolha a profissional."),
  competencia: z
    .string("Competência inválida.")
    .refine((v) => /^\d{4}-\d{2}-01$/.test(v) && dataValida(v), "Competência inválida."),
  pagoEm: dataSchema,
  forma: z.enum(FORMAS_SAIDA, "Escolha a forma de pagamento."),
});

export type PagarComissoesInput = z.input<typeof pagarComissoesSchema>;

/**
 * Paga as comissões em aberto da profissional no mês: cria a despesa
 * (salário, já paga) pelo total e marca as comissões como pagas. Só a dona.
 */
export async function pagarComissoes(e: PagarComissoesInput): Promise<Resultado> {
  await exigirPerfil("dona");
  const lido = pagarComissoesSchema.safeParse(e);
  if (!lido.success) return { ok: false, erro: lido.error.issues[0].message };
  const d = lido.data;
  try {
    const supabase = await createClient();
    const { error } = await supabase.rpc("pagar_comissoes", {
      p_profissional: d.profissionalId,
      p_competencia: d.competencia,
      p_pago_em: d.pagoEm,
      p_forma: d.forma,
    });
    if (error) {
      return {
        ok: false,
        erro: error.code === "23514" ? "Verifique os dados do pagamento." : mensagemErroBanco(error),
      };
    }
    revalidatePath("/financeiro");
    return { ok: true };
  } catch {
    return { ok: false, erro: ERRO_INESPERADO };
  }
}
