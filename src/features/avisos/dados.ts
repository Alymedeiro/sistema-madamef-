import "server-only";
import { avisosPendentes, type ContaAviso } from "@/lib/dominio/financeiro";
import type { Perfil } from "@/lib/dominio/permissoes";
import { somarDias } from "@/features/inicio/painel";
import type { createClient } from "@/lib/supabase/server";
import { hrefConta } from "./link";

type Supabase = Awaited<ReturnType<typeof createClient>>;

export type AvisoItem = {
  chave: string;
  texto: string;
  conta: ContaAviso;
  dias: number;
  href: string;
};

const MAX_LINHAS = 500;

/**
 * Avisos pendentes (só dona, por RLS): contas em aberto a pagar e a receber com
 * vencimento até hoje + 7, menos os já lidos, por vencimento.
 */
export async function carregarAvisos(supabase: Supabase, hoje: string): Promise<AvisoItem[]> {
  const ate = somarDias(hoje, 7);
  const [pagar, receber, lidas] = await Promise.all([
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
    supabase.from("avisos_lidos").select("chave"),
  ]);
  if (pagar.error) throw new Error(`Falha ao carregar as contas a pagar: ${pagar.error.message}`);
  if (receber.error) throw new Error(`Falha ao carregar as contas a receber: ${receber.error.message}`);
  if (lidas.error) throw new Error(`Falha ao carregar os avisos lidos: ${lidas.error.message}`);

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
  const jaLidas = new Set((lidas.data ?? []).map((l) => l.chave));
  return avisosPendentes(contas, hoje, jaLidas).map((a) => ({
    ...a,
    href: hrefConta(a.conta.tipo, a.conta.id, a.dias),
  }));
}

/**
 * Para o layout: só a dona tem avisos; os demais perfis nem chegam a consultar.
 * Falha não derruba o app (o sininho só some).
 */
export async function carregarAvisosDoPerfil(
  supabase: Supabase,
  hoje: string,
  perfil: Perfil,
): Promise<AvisoItem[]> {
  if (perfil !== "dona") return [];
  try {
    return await carregarAvisos(supabase, hoje);
  } catch {
    return [];
  }
}
