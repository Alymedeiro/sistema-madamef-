import "server-only";
import type { FiltroSituacao } from "@/lib/dominio/financeiro";
import type { AbaFinanceiro } from "@/lib/dominio/permissoes";
import type { createClient } from "@/lib/supabase/server";
import {
  carregarProximosVencimentos,
  carregarResumo,
  listarColaboradorasAtivas,
  listarContasFixas,
  listarContasPagar,
  type Resumo,
} from "./dados";
import { carregarFluxo } from "./dados-fluxo";
import { listarContasReceber } from "./dados-receber";

type Supabase = Awaited<ReturnType<typeof createClient>>;

export type FiltrosDaPagina = {
  aba: AbaFinanceiro;
  de: string;
  ate: string;
  situacao: FiltroSituacao;
  busca: string;
  categoria: string;
  hoje: string;
  agora: Date;
};

/**
 * Tudo o que a página do Financeiro (dona) mostra. O resumo gera as contas
 * fixas antes; as consultas de contas (próximos vencimentos e contas a pagar)
 * esperam por ele para já incluí-las. Na aba Caixa do dia os cartões e a
 * equipe (do vale) são acessórios: se falharem, `resumo` vem nulo (cartões
 * "Indisponível no momento") e a equipe vazia, e o caixa continua utilizável.
 */
export async function carregarDadosDaPagina(supabase: Supabase, f: FiltrosDaPagina) {
  const tolerante = f.aba === "caixa";
  const resumoGerado = carregarResumo(supabase, f.de, f.ate, f.agora);
  const periodo = { de: f.de, ate: f.ate };
  const [resumo, proximos, colaboradoras, pagar, receber, fluxo] = await Promise.all([
    tolerante ? resumoGerado.catch((): Resumo | null => null) : resumoGerado,
    f.aba === "painel"
      ? resumoGerado.then(() => carregarProximosVencimentos(supabase, f.hoje))
      : Promise.resolve([]),
    tolerante
      ? listarColaboradorasAtivas(supabase).catch(() => [])
      : listarColaboradorasAtivas(supabase),
    f.aba === "pagar"
      ? resumoGerado.then(() =>
          Promise.all([
            listarContasPagar(
              supabase,
              { ...periodo, situacao: f.situacao, busca: f.busca, categoria: f.categoria },
              f.hoje,
            ),
            listarContasFixas(supabase),
          ]),
        )
      : Promise.resolve(null),
    f.aba === "receber"
      ? listarContasReceber(supabase, { ...periodo, situacao: f.situacao, busca: f.busca }, f.hoje)
      : Promise.resolve(null),
    f.aba === "fluxo" ? carregarFluxo(supabase, f.de, f.ate) : Promise.resolve(null),
  ]);
  return { resumo, proximos, colaboradoras, pagar, receber, fluxo };
}
