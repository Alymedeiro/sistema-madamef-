"use server";

import { revalidatePath } from "next/cache";
import { erroDasPartes, partesParaRpc } from "@/lib/dominio/cobranca";
import { mensagemErroBanco } from "@/lib/erros-db";
import { ERRO_INESPERADO, type Resultado } from "@/lib/resultado";
import { exigirPerfil } from "@/lib/sessao";
import { createClient } from "@/lib/supabase/server";
import { idSchema, MENSAGEM_VALOR_INVALIDO } from "@/lib/validacao";
import { cobrancaSchema, valorTextoSchema, type CobrancaInput } from "./schemas";

// exigirPerfil redireciona lançando; por isso fica fora dos try/catch.

const erro = (mensagem: string) => ({ ok: false as const, erro: mensagem });

export type ResultadoFechamento =
  | { ok: true; diferencaCentavos: number; dinheiroEsperadoCentavos: number }
  | { ok: false; erro: string };

const CAIXA_JA_EXISTE = "Já existe caixa para hoje";
const ATENDIMENTO_NAO_CONCLUIDO = "Só é possível lançar pagamento de atendimento concluído.";
const SESSAO_DE_PACOTE = "Sessão de pacote: já paga na venda do pacote.";
const DESCONTO_MAIOR = "O desconto não pode ser maior que o valor.";
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

export type EstadoCaixaHoje = "aberto" | "fechado" | "nao_aberto";

/**
 * Situação do caixa de hoje para o diálogo de pagamento. A recepção não
 * enxerga caixa fechado (RLS): para ela, fechado aparece como "nao_aberto" e
 * a tentativa de abrir responde "O caixa de hoje já foi fechado.".
 */
export async function estadoCaixaHoje(): Promise<
  { ok: true; estado: EstadoCaixaHoje } | { ok: false; erro: string }
> {
  await exigirPerfil("dona", "recepcao");
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("caixa_de_hoje");
    if (error) return erro(mensagemErroBanco(error));
    if (!data?.id) return { ok: true, estado: "nao_aberto" };
    return { ok: true, estado: data.fechado_em ? "fechado" : "aberto" };
  } catch {
    return erro(ERRO_INESPERADO);
  }
}

/**
 * Cobra um atendimento concluído com 1 a 4 formas (pagamento dividido). O
 * bruto é o valor previsto do agendamento (o banco também o lê de lá); a soma
 * das partes deve ser bruto − desconto. A segunda cobrança do mesmo atendimento
 * falha no banco (cobrancas_agendamento_unico) com "Este atendimento já foi pago.".
 */
export async function registrarCobranca(dados: CobrancaInput): Promise<Resultado> {
  await exigirPerfil("dona", "recepcao");

  const parsed = cobrancaSchema.safeParse(dados);
  if (!parsed.success) return erro(parsed.error.issues[0].message);
  const d = parsed.data;

  try {
    const supabase = await createClient();

    const { data: agendamento, error: erroAg } = await supabase
      .from("agendamentos")
      .select("id, status, valor_previsto_centavos, pacote_vendido_id")
      .eq("id", d.agendamentoId)
      .maybeSingle();
    if (erroAg) return erro(mensagemErroBanco(erroAg));
    if (!agendamento) return erro("Agendamento não encontrado.");
    if (agendamento.status !== "atendido") return erro(ATENDIMENTO_NAO_CONCLUIDO);
    if (agendamento.pacote_vendido_id) return erro(SESSAO_DE_PACOTE);

    const bruto = agendamento.valor_previsto_centavos;
    if (d.desconto > bruto) return erro(DESCONTO_MAIOR);
    const problema = erroDasPartes(bruto - d.desconto, d.partes);
    if (problema) return erro(problema);

    const { error } = await supabase.rpc("registrar_cobranca", {
      p_origem: "agendamento",
      p_agendamento: agendamento.id,
      p_pacote: null,
      p_desconto_centavos: d.desconto,
      p_partes: partesParaRpc(d.partes),
    });
    if (error) return erro(mensagemErroBanco(error));

    revalidatePath("/caixa");
    revalidatePath("/agenda");
    revalidatePath("/inicio");
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
