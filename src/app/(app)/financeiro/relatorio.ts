import "server-only";
import { ROTULO_ORIGEM_RECEBER } from "@/features/financeiro/lista-receber";
import { rotuloPeriodo } from "@/features/financeiro/grafico-fluxo";
import { ROTULO_FORMA } from "@/lib/dominio/caixa";
import {
  ROTULO_FILTRO_SITUACAO_COMISSAO,
  ROTULO_STATUS_COMISSAO,
  filtroSituacaoComissao,
  formatarPercentual,
  type FiltroSituacaoComissao,
} from "@/lib/dominio/comissoes";
import { formatarBRL } from "@/lib/dominio/dinheiro";
import {
  CATEGORIAS_DESPESA,
  ROTULO_CATEGORIA,
  avisoDoLimite,
  filtroSituacao,
  periodoDoFiltro,
  type CategoriaDespesa,
  type FiltroSituacao,
  type situacaoConta,
} from "@/lib/dominio/financeiro";
import { dataNoFuso } from "@/lib/dominio/tempo";
import type { AbaRelatorio, DadosRelatorioPdf } from "@/lib/financeiro/pdf-relatorio";
import type { createClient } from "@/lib/supabase/server";
import { carregarProximosVencimentos, carregarResumo, listarContasPagar } from "./dados";
import { carregarComissoes, profissionalDoFiltro } from "./dados-comissoes";
import { carregarFluxo } from "./dados-fluxo";
import { listarContasReceber } from "./dados-receber";

type Supabase = Awaited<ReturnType<typeof createClient>>;

const ABAS: readonly AbaRelatorio[] = ["painel", "receber", "pagar", "fluxo", "comissoes"];

export type ParametrosRelatorio = {
  aba: AbaRelatorio;
  periodo: ReturnType<typeof periodoDoFiltro>;
  situacao: FiltroSituacao;
  busca: string;
  categoria: CategoriaDespesa | null;
  /** Aba Comissões: situação (padrão Em aberto) e profissional. */
  situacaoComissao: FiltroSituacaoComissao;
  profissionalId: string | null;
};

/** Lê os parâmetros como a página do Financeiro; o que for inválido vira o padrão. */
export function parametrosDoRelatorio(q: URLSearchParams, agora: Date): ParametrosRelatorio {
  const v = (k: string) => q.get(k) ?? undefined;
  const aba = ABAS.find((a) => a === v("aba")) ?? "painel";
  const categoria = CATEGORIAS_DESPESA.find((c) => c === v("categoria")) ?? null;
  return {
    aba,
    periodo: periodoDoFiltro({ periodo: v("periodo"), de: v("de"), ate: v("ate") }, agora),
    situacao: filtroSituacao(v("situacao")),
    busca: (v("busca") ?? "").slice(0, 60),
    categoria,
    situacaoComissao: filtroSituacaoComissao(v("situacao")),
    profissionalId: profissionalDoFiltro(v("profissional")),
  };
}

const dataBr = (s: string | null) => (s ? s.split("-").reverse().join("/") : "—");

/** "Novembro de 2026 (01/11/2026 a 30/11/2026)"; o personalizado já traz as datas. */
export function rotuloDoPeriodo(p: ParametrosRelatorio["periodo"]): string {
  if (p.filtro === "personalizado") return p.rotulo;
  return `${p.rotulo} (${dataBr(p.de)} a ${dataBr(p.ate)})`;
}

const ROTULO_SITUACAO_FILTRO: Record<FiltroSituacao, (tipo: "pagar" | "receber") => string> = {
  todas: () => "Todas",
  aberta: () => "Em aberto",
  vencida: () => "Vencidas",
  paga: (t) => (t === "pagar" ? "Pagas" : "Recebidas"),
  cancelada: () => "Canceladas",
};

function rotuloSituacao(s: ReturnType<typeof situacaoConta>, tipo: "pagar" | "receber"): string {
  if (s === "paga") return tipo === "pagar" ? "Paga" : "Recebida";
  return { em_aberto: "Em aberto", vencida: "Vencida", cancelada: "Cancelada" }[s];
}

const brl = (c: number) => (c < 0 ? `-${formatarBRL(-c)}` : formatarBRL(c));
const contas = (n: number) => (n === 1 ? "1 conta" : `${n} contas`);
const soma = (xs: { valorCentavos: number }[]) => xs.reduce((s, x) => s + x.valorCentavos, 0);

function filtrosDaLista(p: ParametrosRelatorio, tipo: "pagar" | "receber", linhas: number): string[] {
  const f = [`Situação: ${ROTULO_SITUACAO_FILTRO[p.situacao](tipo)}`];
  if (tipo === "pagar" && p.categoria) f.push(`Categoria: ${ROTULO_CATEGORIA[p.categoria]}`);
  if (p.busca.trim()) f.push(`Busca: "${p.busca.trim()}"`);
  const limite = avisoDoLimite(linhas);
  if (limite) f.push(limite);
  return f;
}

type Conteudo = Pick<DadosRelatorioPdf, "filtros" | "cartoes" | "colunas" | "linhas" | "totais">;

/**
 * Conteúdo do PDF da aba, com os mesmos carregadores e filtros da página.
 * Só a dona (as RPCs e o RLS recusam os demais).
 */
export async function conteudoDoRelatorio(
  supabase: Supabase,
  p: ParametrosRelatorio,
  agora: Date,
): Promise<Conteudo> {
  const hoje = dataNoFuso(agora);
  const { de, ate } = p.periodo;

  if (p.aba === "fluxo") {
    const fluxo = await carregarFluxo(supabase, de, ate);
    return {
      filtros: [`Agrupado por ${fluxo.agrupar === "mes" ? "mês" : "dia"}`],
      colunas: [fluxo.agrupar === "mes" ? "Mês" : "Dia", "Entradas", "Saídas", "Saldo", "Acumulado"],
      linhas: fluxo.linhas.map((l) => [
        rotuloPeriodo(l.periodo, fluxo.agrupar),
        brl(l.entradas),
        brl(l.saidas),
        brl(l.saldo),
        brl(l.acumulado),
      ]),
      totais: [
        ["Entradas", brl(fluxo.totais.entradas)],
        ["Saídas", brl(fluxo.totais.saidas)],
        ["Saldo", brl(fluxo.totais.saldo)],
        ...fluxo.porForma.map((f): [string, string] => [`Entradas por forma — ${ROTULO_FORMA[f.forma]}`, brl(f.total)]),
        ...fluxo.porCategoria.map((c): [string, string] => [
          `Despesas por categoria — ${ROTULO_CATEGORIA[c.categoria]}`,
          brl(c.total),
        ]),
      ],
    };
  }

  if (p.aba === "comissoes") {
    const c = await carregarComissoes(supabase, {
      de,
      ate,
      situacao: p.situacaoComissao,
      profissionalId: p.profissionalId,
    });
    const filtros = [`Situação: ${ROTULO_FILTRO_SITUACAO_COMISSAO[p.situacaoComissao]}`];
    const profissional = c.profissionais.find((x) => x.id === p.profissionalId);
    if (profissional) filtros.push(`Profissional: ${profissional.nome}`);
    const limite = avisoDoLimite(c.linhas.length);
    if (limite) filtros.push(limite);
    return {
      filtros,
      colunas: ["Data", "Cliente", "Serviço", "Profissional", "Base", "%", "Valor", "Situação"],
      linhas: c.linhas.map((l) => [
        dataBr(l.data || null),
        l.clienteNome,
        l.servicoNome,
        l.profissionalNome,
        brl(l.baseCentavos),
        formatarPercentual(l.percentual),
        brl(l.valorCentavos),
        ROTULO_STATUS_COMISSAO[l.status],
      ]),
      totais: [
        ["A pagar", brl(c.totais.abertoCentavos)],
        ["Pago", brl(c.totais.pagoCentavos)],
      ],
    };
  }

  if (p.aba === "receber") {
    const lista = await listarContasReceber(supabase, { de, ate, situacao: p.situacao, busca: p.busca }, hoje);
    return {
      filtros: filtrosDaLista(p, "receber", lista.length),
      colunas: ["Cliente", "Descrição/origem", "Parcela", "Vencimento", "Valor", "Situação", "Recebida em"],
      linhas: lista.map((c) => [
        c.clienteNome,
        c.descricao ?? ROTULO_ORIGEM_RECEBER[c.origem],
        c.parcela,
        dataBr(c.vencimento),
        brl(c.valorCentavos),
        rotuloSituacao(c.situacao, "receber"),
        dataBr(c.recebidoEm),
      ]),
      totais: [
        ["Contas listadas", contas(lista.length)],
        ["Total", brl(soma(lista))],
      ],
    };
  }

  // Painel e Contas a pagar: o resumo gera as contas fixas antes das listas.
  const cartoes = await carregarResumo(supabase, de, ate, agora);

  if (p.aba === "pagar") {
    const lista = await listarContasPagar(
      supabase,
      { de, ate, situacao: p.situacao, busca: p.busca, categoria: p.categoria ?? "" },
      hoje,
    );
    return {
      filtros: filtrosDaLista(p, "pagar", lista.length),
      colunas: ["Descrição", "Categoria", "Fornecedor/colaboradora", "Vencimento", "Valor", "Situação", "Paga em"],
      linhas: lista.map((c) => [
        c.fixa ? `${c.descricao} (todo mês)` : c.descricao,
        ROTULO_CATEGORIA[c.categoria],
        c.quem ?? "—",
        dataBr(c.vencimento),
        brl(c.valorCentavos),
        rotuloSituacao(c.situacao, "pagar"),
        c.pagoEm ? `${dataBr(c.pagoEm)}${c.forma ? ` (${ROTULO_FORMA[c.forma as keyof typeof ROTULO_FORMA]})` : ""}` : "—",
      ]),
      totais: [
        ["Contas listadas", contas(lista.length)],
        ["Total", brl(soma(lista))],
      ],
    };
  }

  // Painel: cartões + contas vencidas (qualquer período, como o cartão Vencidos) + próximos 7 dias.
  const [pagarVencidas, receberVencidas, proximos] = await Promise.all([
    listarContasPagar(supabase, { de, ate, situacao: "vencida" }, hoje),
    listarContasReceber(supabase, { de, ate, situacao: "vencida" }, hoje),
    carregarProximosVencimentos(supabase, hoje),
  ]);
  const vencidas = [
    ...pagarVencidas.map((c) => ({
      tipo: "A pagar",
      nome: c.descricao,
      detalhe: c.quem ?? "—",
      vencimento: c.vencimento,
      valorCentavos: c.valorCentavos,
    })),
    ...receberVencidas.map((c) => ({
      tipo: "A receber",
      nome: c.clienteNome,
      detalhe: c.descricao ?? `parcela ${c.parcela}`,
      vencimento: c.vencimento,
      valorCentavos: c.valorCentavos,
    })),
  ].sort((a, b) => a.vencimento.localeCompare(b.vencimento));
  return {
    filtros: [],
    cartoes,
    colunas: ["Situação", "Tipo", "Conta/cliente", "Detalhe", "Vencimento", "Valor"],
    linhas: [
      ...vencidas.map((c) => ["Vencida", c.tipo, c.nome, c.detalhe, dataBr(c.vencimento), brl(c.valorCentavos)]),
      ...proximos.map((c) => [
        "Próximos 7 dias",
        c.tipo === "pagar" ? "A pagar" : "A receber",
        c.nome,
        c.detalhe ?? "—",
        dataBr(c.vencimento),
        brl(c.valorCentavos),
      ]),
    ],
    totais: [
      [`Vencidas (${contas(vencidas.length)})`, brl(soma(vencidas))],
      [`Próximos 7 dias (${contas(proximos.length)})`, brl(soma(proximos))],
    ],
  };
}
