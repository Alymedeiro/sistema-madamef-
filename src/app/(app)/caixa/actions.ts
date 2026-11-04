"use server";

import { revalidatePath } from "next/cache";
import { gerarParcelas, formaParcelada } from "@/lib/dominio/caixa";
import { mensagemErroBanco } from "@/lib/erros-db";
import { ERRO_INESPERADO, type Resultado } from "@/lib/resultado";
import { exigirPerfil } from "@/lib/sessao";
import { createClient } from "@/lib/supabase/server";
import { idSchema, MENSAGEM_VALOR_INVALIDO } from "@/lib/validacao";
import { pagamentoSchema, valorTextoSchema, type PagamentoInput } from "./schemas";

// exigirPerfil redireciona lançando; por isso fica fora dos try/catch.

const erro = (mensagem: string) => ({ ok: false as const, erro: mensagem });

export type ResultadoFechamento =
  | { ok: true; diferencaCentavos: number; dinheiroEsperadoCentavos: number }
  | { ok: false; erro: string };

const CAIXA_JA_EXISTE = "Já existe caixa para hoje";
const CAIXA_FECHADO = "O caixa de hoje já foi fechado.";

function valorCentavos(texto: string): number | null {
  const r = valorTextoSchema.safeParse(texto);
  return r.success ? r.data : null;
}

/** Abre o caixa de hoje com o troco inicial. Se já estiver aberto, segue em frente. */
export async function abrirCaixa(valorInicial: string): Promise<Resultado> {
  await exigirPerfil("dona", "recepcao");

  const centavos = valorCentavos(valorInicial);
  if (centavos === null) return erro(MENSAGEM_VALOR_INVALIDO);

  try {
    const supabase = await createClient();
    const { error } = await supabase.rpc("abrir_caixa", { p_valor_inicial_centavos: centavos });
    if (error) {
      if (error.message === CAIXA_JA_EXISTE) {
        // Aberto por outra pessoa: tudo certo. Fechado (ou invisível à recepção): avisa.
        const { data: hoje } = await supabase.rpc("caixa_de_hoje");
        if (hoje?.id && !hoje.fechado_em) {
          revalidatePath("/caixa");
          return { ok: true };
        }
        return erro(CAIXA_FECHADO);
      }
      return erro(mensagemErroBanco(error));
    }
    revalidatePath("/caixa");
    return { ok: true };
  } catch {
    return erro(ERRO_INESPERADO);
  }
}

/** O caixa de hoje está aberto? (usado pelo diálogo de pagamento) */
export async function caixaAbertoHoje(): Promise<
  { ok: true; aberto: boolean } | { ok: false; erro: string }
> {
  await exigirPerfil("dona", "recepcao");
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("caixa_de_hoje");
    if (error) return erro(mensagemErroBanco(error));
    return { ok: true, aberto: !!data?.id && !data.fechado_em };
  } catch {
    return erro(ERRO_INESPERADO);
  }
}

/**
 * Lança o pagamento de um atendimento. A cliente vem do agendamento (a enviada
 * pela tela é ignorada). Fase 1: sempre com agendamento (Ruling R12).
 */
export async function registrarPagamento(dados: PagamentoInput): Promise<Resultado> {
  await exigirPerfil("dona", "recepcao");

  const parsed = pagamentoSchema.safeParse(dados);
  if (!parsed.success) return erro(parsed.error.issues[0].message);
  const d = parsed.data;
  const parcelas = formaParcelada(d.forma) ? d.parcelas : 1;

  try {
    const supabase = await createClient();

    const { data: agendamento, error: erroAg } = await supabase
      .from("agendamentos")
      .select("id, cliente_id")
      .eq("id", d.agendamentoId)
      .maybeSingle();
    if (erroAg) return erro(mensagemErroBanco(erroAg));
    if (!agendamento) return erro("Agendamento não encontrado.");

    let vencimentos: string[] | null = null;
    let valoresParcelas: number[] | null = null;
    if (d.forma === "a_receber") {
      const lista = gerarParcelas(d.valor - d.desconto, parcelas, d.primeiroVencimento!);
      vencimentos = lista.map((p) => p.vencimento);
      valoresParcelas = lista.map((p) => p.valorCentavos);
    }

    const { error } = await supabase.rpc("registrar_pagamento", {
      p_cliente: agendamento.cliente_id,
      p_agendamento: agendamento.id,
      p_forma: d.forma,
      p_valor_centavos: d.valor,
      p_desconto_centavos: d.desconto,
      p_parcelas: parcelas,
      p_vencimentos: vencimentos,
      p_valores_parcelas: valoresParcelas,
    });
    if (error) return erro(mensagemErroBanco(error));

    revalidatePath("/caixa");
    revalidatePath("/agenda");
    return { ok: true };
  } catch {
    return erro(ERRO_INESPERADO);
  }
}

/** Fecha o caixa com o dinheiro contado; devolve a diferença calculada pelo banco. */
export async function fecharCaixa(caixaId: string, valorContado: string): Promise<ResultadoFechamento> {
  await exigirPerfil("dona", "recepcao");

  const id = idSchema.safeParse(caixaId);
  if (!id.success) return erro(id.error.issues[0].message);
  const centavos = valorCentavos(valorContado);
  if (centavos === null) return erro(MENSAGEM_VALOR_INVALIDO);

  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("fechar_caixa", {
      p_caixa: id.data,
      p_valor_contado_centavos: centavos,
    });
    if (error) return erro(mensagemErroBanco(error));

    const r = (data ?? {}) as { diferenca?: unknown; dinheiro_esperado?: unknown };
    if (typeof r.diferenca !== "number" || typeof r.dinheiro_esperado !== "number") {
      return erro(ERRO_INESPERADO);
    }
    revalidatePath("/caixa");
    return {
      ok: true,
      diferencaCentavos: r.diferenca,
      dinheiroEsperadoCentavos: r.dinheiro_esperado,
    };
  } catch {
    return erro(ERRO_INESPERADO);
  }
}
