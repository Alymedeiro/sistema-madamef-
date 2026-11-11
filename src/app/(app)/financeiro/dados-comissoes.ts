import "server-only";
import type { FiltroSituacaoComissao, StatusComissao } from "@/lib/dominio/comissoes";
import { MAX_LINHAS_LISTA } from "@/lib/dominio/financeiro";
import { dataNoFuso } from "@/lib/dominio/tempo";
import type { createClient } from "@/lib/supabase/server";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** Uma profissional num mês (competência), sem as canceladas. */
export type LinhaResumo = {
  profissionalId: string;
  nome: string;
  /** AAAA-MM-01. */
  competencia: string;
  /** Atendimentos. */
  qtd: number;
  baseCentavos: number;
  abertoCentavos: number;
  pagoCentavos: number;
};

export type LinhaComissao = {
  id: string;
  /** Dia (SP) do atendimento. */
  data: string;
  clienteNome: string;
  servicoNome: string;
  profissionalId: string;
  profissionalNome: string;
  competencia: string;
  baseCentavos: number;
  percentual: number;
  valorCentavos: number;
  status: StatusComissao;
  pagoEm: string | null;
};

export type FiltrosComissoes = {
  de: string;
  ate: string;
  situacao: FiltroSituacaoComissao;
  /** Só esta profissional (id validado) ou todas. */
  profissionalId: string | null;
};

export type DadosComissoes = {
  resumo: LinhaResumo[];
  linhas: LinhaComissao[];
  /** Soma do resumo (respeita o filtro de profissional). */
  totais: { abertoCentavos: number; pagoCentavos: number };
  /** Profissionais com comissão no período (para o filtro). */
  profissionais: { id: string; nome: string }[];
};

type LinhaBanco = {
  id: string;
  profissional_id: string;
  competencia: string;
  base_centavos: number;
  percentual: number;
  valor_centavos: number;
  status: StatusComissao;
  pago_em: string | null;
  agendamentos: { inicio: string; clientes: { nome: string } | null } | null;
  servicos: { nome: string } | null;
  colaboradores: { nome: string } | null;
};

const COLUNAS =
  "id, profissional_id, competencia, base_centavos, percentual, valor_centavos, status, pago_em, agendamentos(inicio, clientes(nome)), servicos(nome), colaboradores(nome)";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** O id do filtro de profissional se for um uuid; senão null (todas). */
export function profissionalDoFiltro(v: string | undefined): string | null {
  return v && UUID.test(v) ? v : null;
}

/** Competências do período: do mês de `de` até `ate` (como resumo_comissoes). */
const inicioDoMes = (d: string) => `${d.slice(0, 7)}-01`;

/**
 * Aba Comissões (dona): resumo por profissional e mês (resumo_comissoes) e a
 * lista detalhada com os filtros de situação (padrão Em aberto) e profissional.
 */
export async function carregarComissoes(supabase: Supabase, f: FiltrosComissoes): Promise<DadosComissoes> {
  let q = supabase
    .from("comissoes")
    .select(COLUNAS)
    .gte("competencia", inicioDoMes(f.de))
    .lte("competencia", f.ate);
  if (f.situacao !== "todas") q = q.eq("status", f.situacao);
  if (f.profissionalId) q = q.eq("profissional_id", f.profissionalId);

  const [resumoRpc, lista] = await Promise.all([
    supabase.rpc("resumo_comissoes", { p_de: f.de, p_ate: f.ate }),
    q.order("competencia").order("criado_em").limit(MAX_LINHAS_LISTA),
  ]);
  if (resumoRpc.error) throw new Error(`Falha ao carregar o resumo das comissões: ${resumoRpc.error.message}`);
  if (lista.error) throw new Error(`Falha ao carregar as comissões: ${lista.error.message}`);

  const todos: LinhaResumo[] = (resumoRpc.data ?? []).map((r) => ({
    profissionalId: r.profissional_id,
    nome: r.nome,
    competencia: r.competencia,
    qtd: Number(r.qtd),
    baseCentavos: Number(r.base),
    abertoCentavos: Number(r.aberto),
    pagoCentavos: Number(r.pago),
  }));

  const linhas = ((lista.data ?? []) as unknown as LinhaBanco[])
    .map((c) => ({
      inicio: c.agendamentos?.inicio ?? "",
      linha: {
        id: c.id,
        data: c.agendamentos ? dataNoFuso(c.agendamentos.inicio) : "",
        clienteNome: c.agendamentos?.clientes?.nome ?? "—",
        servicoNome: c.servicos?.nome ?? "—",
        profissionalId: c.profissional_id,
        profissionalNome: c.colaboradores?.nome ?? "—",
        competencia: c.competencia,
        baseCentavos: c.base_centavos,
        percentual: Number(c.percentual),
        valorCentavos: c.valor_centavos,
        status: c.status,
        pagoEm: c.pago_em,
      } satisfies LinhaComissao,
    }))
    .sort((a, b) => a.inicio.localeCompare(b.inicio) || a.linha.profissionalNome.localeCompare(b.linha.profissionalNome, "pt-BR"))
    .map((x) => x.linha);

  const resumo = f.profissionalId ? todos.filter((r) => r.profissionalId === f.profissionalId) : todos;

  const nomes = new Map<string, string>();
  for (const r of todos) nomes.set(r.profissionalId, r.nome);
  for (const l of linhas) if (!nomes.has(l.profissionalId)) nomes.set(l.profissionalId, l.profissionalNome);
  const profissionais = [...nomes]
    .map(([id, nome]) => ({ id, nome }))
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));

  return {
    resumo,
    linhas,
    totais: {
      abertoCentavos: resumo.reduce((s, r) => s + r.abertoCentavos, 0),
      pagoCentavos: resumo.reduce((s, r) => s + r.pagoCentavos, 0),
    },
    profissionais,
  };
}
