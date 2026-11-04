"use server";

import { revalidatePath } from "next/cache";
import { erroDasPartes, partesParaRpc } from "@/lib/dominio/cobranca";
import { pacoteUtilizavel, progressoPacote, type StatusPacote } from "@/lib/dominio/pacotes";
import { dataNoFuso } from "@/lib/dominio/tempo";
import { mensagemErroBanco } from "@/lib/erros-db";
import { ERRO_INESPERADO, type Resultado } from "@/lib/resultado";
import { exigirPerfil } from "@/lib/sessao";
import { createClient } from "@/lib/supabase/server";
import { idSchema } from "@/lib/validacao";
import { vendaPacoteSchema, type VendaPacoteInput } from "./schemas";

// exigirPerfil redireciona lançando; por isso fica fora dos try/catch.

const erro = (mensagem: string) => ({ ok: false as const, erro: mensagem });

/**
 * Vende um pacote e registra a cobrança dele (pagamento dividido) no caixa de
 * hoje, numa transação do banco. O líquido é valor total − desconto.
 */
export async function venderPacote(
  dados: VendaPacoteInput,
): Promise<{ ok: true; id: string } | { ok: false; erro: string }> {
  await exigirPerfil("dona", "recepcao");

  const parsed = vendaPacoteSchema.safeParse(dados);
  if (!parsed.success) return erro(parsed.error.issues[0].message);
  const d = parsed.data;

  if (d.desconto > d.valorTotal) return erro("O desconto não pode ser maior que o valor.");
  const problema = erroDasPartes(d.valorTotal - d.desconto, d.partes);
  if (problema) return erro(problema);

  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("vender_pacote", {
      p_cliente: d.clienteId,
      p_servico: d.servicoId,
      p_total_sessoes: d.sessoes,
      p_valor_total_centavos: d.valorTotal,
      p_validade: d.validade,
      p_desconto_centavos: d.desconto,
      p_partes: partesParaRpc(d.partes),
    });
    if (error) return erro(mensagemErroBanco(error));
    if (!data) return erro(ERRO_INESPERADO);

    revalidatePath(`/clientes/${d.clienteId}`);
    revalidatePath("/caixa");
    return { ok: true, id: data };
  } catch {
    return erro(ERRO_INESPERADO);
  }
}

/** Cancela um pacote ativo (só a dona). O banco recusa pacote que não está ativo. */
export async function cancelarPacote(id: string): Promise<Resultado> {
  await exigirPerfil("dona");

  const lido = idSchema.safeParse(id);
  if (!lido.success) return erro(lido.error.issues[0].message);

  try {
    const supabase = await createClient();
    const { error } = await supabase.rpc("cancelar_pacote", { p_pacote: lido.data });
    if (error) return erro(mensagemErroBanco(error));
    revalidatePath("/clientes/[id]", "page");
    return { ok: true };
  } catch {
    return erro(ERRO_INESPERADO);
  }
}

/** Pacotes da cliente que ainda podem pagar uma sessão deste serviço. */
export async function pacotesDisponiveis(
  clienteId: string,
  servicoId: string,
): Promise<{ id: string; restantes: number; validade: string | null }[]> {
  await exigirPerfil("dona", "recepcao");
  if (!idSchema.safeParse(clienteId).success || !idSchema.safeParse(servicoId).success) return [];

  try {
    const supabase = await createClient();
    // Falha ao expirar não impede a consulta: o status efetivo é recalculado abaixo.
    await supabase.rpc("expirar_pacotes");
    const { data, error } = await supabase
      .from("pacotes_vendidos")
      .select("id, servico_id, status, validade, sessoes_usadas, total_sessoes")
      .eq("cliente_id", clienteId)
      .eq("servico_id", servicoId)
      .order("vendido_em");
    if (error || !data) return [];
    const hoje = dataNoFuso(new Date());
    return data
      .map((p) => ({
        id: p.id,
        servicoId: p.servico_id,
        status: p.status as StatusPacote,
        validade: p.validade,
        sessoesUsadas: p.sessoes_usadas,
        totalSessoes: p.total_sessoes,
      }))
      .filter((p) => pacoteUtilizavel(p, servicoId, hoje))
      .map((p) => ({
        id: p.id,
        restantes: progressoPacote(p.sessoesUsadas, p.totalSessoes).restantes,
        validade: p.validade,
      }));
  } catch {
    return [];
  }
}
