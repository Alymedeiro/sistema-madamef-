"use server";

import { revalidatePath } from "next/cache";
import type { ZodType } from "zod";
import { BUCKET_FINANCEIRO, URL_ANEXO_SEGUNDOS } from "@/features/financeiro/anexo";
import { mensagemErroBanco, type ErroBanco } from "@/lib/erros-db";
import { ERRO_INESPERADO, type Resultado } from "@/lib/resultado";
import { exigirPerfil } from "@/lib/sessao";
import { createClient } from "@/lib/supabase/server";
import { idSchema } from "@/lib/validacao";
import {
  cancelarContaSchema,
  contaFixaSchema,
  contaPagarSchema,
  editarContaPagarSchema,
  pagarContaSchema,
  valeSchema,
  type CancelarContaInput,
  type ContaFixaInput,
  type ContaPagarInput,
  type EditarContaPagarInput,
  type PagarContaInput,
  type ValeInput,
} from "./schemas";

// Tudo aqui é só da dona. exigirPerfil redireciona lançando: fica fora dos try/catch.

type Supabase = Awaited<ReturnType<typeof createClient>>;

const erro = (mensagem: string) => ({ ok: false as const, erro: mensagem });

/** Check do banco (23514) vira uma mensagem amigável; o resto segue o padrão. */
function mensagem(e: ErroBanco): string {
  return e.code === "23514" ? "Verifique os dados da conta." : mensagemErroBanco(e);
}

/** Valida, chama o banco e revalida o Financeiro (e o Início, que mostra vencimentos). */
async function executar<T>(
  schema: ZodType<T>,
  entrada: unknown,
  chamar: (supabase: Supabase, d: T) => PromiseLike<{ error: ErroBanco | null }>,
): Promise<Resultado> {
  const lido = schema.safeParse(entrada);
  if (!lido.success) return erro(lido.error.issues[0].message);
  try {
    const supabase = await createClient();
    const { error } = await chamar(supabase, lido.data);
    if (error) return erro(mensagem(error));
    revalidatePath("/financeiro");
    revalidatePath("/inicio");
    return { ok: true };
  } catch {
    return erro(ERRO_INESPERADO);
  }
}

export async function criarContaPagar(e: ContaPagarInput): Promise<Resultado> {
  await exigirPerfil("dona");
  return executar(contaPagarSchema, e, (s, d) =>
    s.rpc("criar_conta_pagar", {
      p_descricao: d.descricao,
      p_categoria: d.categoria,
      p_fornecedor: d.fornecedor,
      p_valor_centavos: d.valor,
      p_vencimento: d.vencimento,
      p_anexo_path: d.anexoPath,
    }),
  );
}

/** Só conta em aberto (o banco recusa paga/cancelada); anexo null remove. */
export async function editarContaPagar(e: EditarContaPagarInput): Promise<Resultado> {
  await exigirPerfil("dona");
  return executar(editarContaPagarSchema, e, (s, d) =>
    s.rpc("editar_conta_pagar", {
      p_conta: d.contaId,
      p_descricao: d.descricao,
      p_categoria: d.categoria,
      p_fornecedor: d.fornecedor,
      p_valor_centavos: d.valor,
      p_vencimento: d.vencimento,
      p_anexo_path: d.anexoPath,
    }),
  );
}

export async function pagarConta(e: PagarContaInput): Promise<Resultado> {
  await exigirPerfil("dona");
  return executar(pagarContaSchema, e, (s, d) =>
    s.rpc("pagar_conta", { p_conta: d.contaId, p_pago_em: d.pagoEm, p_forma: d.forma }),
  );
}

/** Cancela conta a pagar ou a receber (motivo de 1 a 200 caracteres). */
export async function cancelarConta(e: CancelarContaInput): Promise<Resultado> {
  await exigirPerfil("dona");
  return executar(cancelarContaSchema, e, (s, d) =>
    s.rpc(d.tipo === "pagar" ? "cancelar_conta_pagar" : "cancelar_conta_receber", {
      p_conta: d.contaId,
      p_motivo: d.motivo,
    }),
  );
}

/** Vale de colaboradora: despesa já paga na data. */
export async function lancarVale(e: ValeInput): Promise<Resultado> {
  await exigirPerfil("dona");
  return executar(valeSchema, e, (s, d) =>
    s.rpc("lancar_vale", {
      p_colaborador: d.colaboradorId,
      p_valor_centavos: d.valor,
      p_data: d.data,
      p_forma: d.forma,
      p_obs: d.obs,
    }),
  );
}

/** Conta que se repete todo mês no dia escolhido (a partir do mês de `inicio`). */
export async function criarContaFixa(e: ContaFixaInput): Promise<Resultado> {
  await exigirPerfil("dona");
  return executar(contaFixaSchema, e, (s, d) =>
    s.rpc("criar_conta_fixa", {
      p_descricao: d.descricao,
      p_categoria: d.categoria,
      p_fornecedor: d.fornecedor,
      p_valor_centavos: d.valor,
      p_dia: d.dia,
      p_inicio: d.inicio,
    }),
  );
}

/** Para de gerar a conta fixa; as já geradas continuam. */
export async function desativarContaFixa(id: string): Promise<Resultado> {
  await exigirPerfil("dona");
  return executar(idSchema, id, (s, d) => s.rpc("desativar_conta_fixa", { p_id: d }));
}

/** URL assinada (300 s) do anexo da conta. RLS: só a dona lê a conta e o arquivo. */
export async function urlAnexo(
  contaId: string,
): Promise<{ ok: true; url: string } | { ok: false; erro: string }> {
  await exigirPerfil("dona");
  const NAO_ENCONTRADO = "Anexo não encontrado.";
  if (!idSchema.safeParse(contaId).success) return erro(NAO_ENCONTRADO);
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("contas_pagar")
      .select("anexo_path")
      .eq("id", contaId)
      .maybeSingle();
    if (error) return erro(mensagemErroBanco(error));
    if (!data?.anexo_path) return erro(NAO_ENCONTRADO);
    const { data: assinada, error: erroUrl } = await supabase.storage
      .from(BUCKET_FINANCEIRO)
      .createSignedUrl(data.anexo_path, URL_ANEXO_SEGUNDOS);
    if (erroUrl || !assinada?.signedUrl) return erro(NAO_ENCONTRADO);
    return { ok: true, url: assinada.signedUrl };
  } catch {
    return erro(ERRO_INESPERADO);
  }
}
