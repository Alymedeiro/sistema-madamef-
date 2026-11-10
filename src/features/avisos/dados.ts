import "server-only";
import {
  avisosPendentes,
  diasEntre,
  fimDoMesSeguinte,
  type ContaAviso,
} from "@/lib/dominio/financeiro";
import { combinarDataHora } from "@/lib/dominio/tempo";
import type { Perfil } from "@/lib/dominio/permissoes";
import { somarDias } from "@/features/inicio/painel";
import type { createClient } from "@/lib/supabase/server";
import { hrefConta } from "./link";
import { textoVencimento } from "./texto";

type Supabase = Awaited<ReturnType<typeof createClient>>;

export type AvisoItem = {
  chave: string;
  texto: string;
  conta: ContaAviso;
  dias: number;
  href: string;
};

const MAX_LINHAS = 500;

/** Contas em aberto (pagar e receber) com vencimento até hoje + 7. Só dona (RLS). */
async function contasAbertas(supabase: Supabase, hoje: string): Promise<ContaAviso[]> {
  const ate = somarDias(hoje, 7);
  const [pagar, receber] = await Promise.all([
    supabase
      .from("contas_pagar")
      .select("id, descricao, valor_centavos, vencimento")
      .eq("status", "aberta")
      .lte("vencimento", ate)
      .order("vencimento")
      .limit(MAX_LINHAS),
    supabase
      .from("contas_receber")
      .select("id, descricao, valor_centavos, vencimento, numero, total_parcelas, clientes(nome)")
      .is("recebido_em", null)
      .is("cancelada_em", null)
      .lte("vencimento", ate)
      .order("vencimento")
      .limit(MAX_LINHAS),
  ]);
  if (pagar.error) throw new Error(`Falha ao carregar as contas a pagar: ${pagar.error.message}`);
  if (receber.error) throw new Error(`Falha ao carregar as contas a receber: ${receber.error.message}`);

  const contas: ContaAviso[] = [
    ...(pagar.data ?? []).map((c) => ({
      tipo: "pagar" as const,
      id: c.id,
      nome: c.descricao,
      valorCentavos: c.valor_centavos,
      vencimento: c.vencimento,
    })),
    ...(receber.data ?? []).map((c) => ({
      tipo: "receber" as const,
      id: c.id,
      nome: c.clientes?.nome ?? "—",
      valorCentavos: c.valor_centavos,
      vencimento: c.vencimento,
      parcela: c.descricao ?? `parcela ${c.numero}/${c.total_parcelas}`,
    })),
  ];
  return contas.sort((a, b) => a.vencimento.localeCompare(b.vencimento));
}

/**
 * Avisos pendentes (só dona, por RLS): contas em aberto a pagar e a receber com
 * vencimento até hoje + 7, menos os lidos hoje, por vencimento. Só os lidos a
 * partir de 00:00 de hoje (SP) contam: cada marco é de um dia só, e assim a
 * leitura não cresce com o histórico.
 */
export async function carregarAvisos(supabase: Supabase, hoje: string): Promise<AvisoItem[]> {
  const inicioDeHoje = combinarDataHora(hoje, "00:00");
  const [contas, lidas] = await Promise.all([
    contasAbertas(supabase, hoje),
    supabase
      .from("avisos_lidos")
      .select("chave, lido_em")
      .gte("lido_em", inicioDeHoje.toISOString()),
  ]);
  if (lidas.error) throw new Error(`Falha ao carregar os avisos lidos: ${lidas.error.message}`);
  const jaLidas = new Set(
    (lidas.data ?? [])
      .filter((l) => new Date(l.lido_em) >= inicioDeHoje)
      .map((l) => l.chave),
  );
  return avisosPendentes(contas, hoje, jaLidas).map((a) => ({
    ...a,
    href: hrefConta(a.conta.tipo, a.conta.id, a.dias),
  }));
}

export type ContaVencendo = {
  chave: string;
  conta: ContaAviso;
  dias: number;
  texto: string;
  href: string;
};

/**
 * Cartão "Contas vencendo" do Início (só dona): contas em aberto vencidas ou
 * vencendo em até 7 dias, por vencimento. Não depende dos avisos lidos.
 */
export async function carregarContasVencendo(
  supabase: Supabase,
  hoje: string,
  limite = 5,
): Promise<ContaVencendo[]> {
  const contas = await contasAbertas(supabase, hoje);
  return contas.slice(0, limite).map((conta) => {
    const dias = diasEntre(hoje, conta.vencimento);
    return {
      chave: `${conta.tipo}:${conta.id}`,
      conta,
      dias,
      texto: textoVencimento(dias),
      href: hrefConta(conta.tipo, conta.id, dias),
    };
  });
}

/**
 * Para o layout: só a dona tem avisos; os demais perfis nem chegam a consultar.
 * Antes gera as contas fixas até o fim do mês seguinte (idempotente), para o
 * sininho avisar delas mesmo sem abrir o Financeiro. Falha não derruba o app
 * (o sininho só some; falha ao gerar só deixa de incluir as fixas novas).
 */
export async function carregarAvisosDoPerfil(
  supabase: Supabase,
  hoje: string,
  perfil: Perfil,
): Promise<AvisoItem[]> {
  if (perfil !== "dona") return [];
  try {
    await supabase.rpc("gerar_contas_fixas", { p_ate: fimDoMesSeguinte(hoje) });
  } catch {
    // Segue sem as fixas novas.
  }
  try {
    return await carregarAvisos(supabase, hoje);
  } catch {
    return [];
  }
}
