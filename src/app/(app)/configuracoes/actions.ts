"use server";

import { revalidatePath } from "next/cache";
import { mensagemErroBanco } from "@/lib/erros-db";
import { ERRO_INESPERADO, falha, OK, type Resultado } from "@/lib/resultado";
import { exigirPerfil } from "@/lib/sessao";
import { createClient } from "@/lib/supabase/server";
import { configuracoesSchema, type ConfiguracoesInput } from "./schemas";

export async function salvarConfiguracoes(dados: ConfiguracoesInput): Promise<Resultado> {
  await exigirPerfil("dona");

  const parsed = configuracoesSchema.safeParse(dados);
  if (!parsed.success) return falha(parsed.error.issues[0].message);
  const {
    nome,
    telefone,
    endereco,
    horarioFuncionamento,
    onlineAtivo,
    onlineAntecedenciaMinHoras,
    onlineAntecedenciaMaxDias,
    onlineAvisoPrivacidade,
  } = parsed.data;

  try {
    const supabase = await createClient();
    // A tabela guarda uma única linha (linha_unica = true): upsert por essa chave.
    const { error } = await supabase.from("configuracoes_clinica").upsert(
      {
        linha_unica: true,
        nome,
        telefone,
        endereco,
        horario_funcionamento: horarioFuncionamento,
        online_ativo: onlineAtivo,
        online_antecedencia_min_horas: onlineAntecedenciaMinHoras,
        online_antecedencia_max_dias: onlineAntecedenciaMaxDias,
        online_aviso_privacidade: onlineAvisoPrivacidade,
      },
      { onConflict: "linha_unica" },
    );
    if (error) return falha(mensagemErroBanco(error));
  } catch {
    return falha(ERRO_INESPERADO);
  }

  revalidatePath("/configuracoes");
  return OK;
}
