import { dataNoFuso } from "./tempo";

export type FiltroPeriodo =
  | "mes"
  | "mes_passado"
  | "proximo_mes"
  | "ano"
  | "tudo"
  | "personalizado";

const MESES = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
];

const DATA = /^(\d{4})-(\d{2})-(\d{2})$/;
const DIA_MS = 86_400_000;

const dois = (n: number) => String(n).padStart(2, "0");
const iso = (a: number, m: number, d: number) => `${a}-${dois(m)}-${dois(d)}`;

/** Último dia do mês (mes 1-12). */
function ultimoDia(ano: number, mes: number): number {
  return new Date(Date.UTC(ano, mes, 0)).getUTCDate();
}

function dataValida(s: string | undefined): s is string {
  if (!s) return false;
  const m = DATA.exec(s);
  if (!m) return false;
  const [a, mes, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  return mes >= 1 && mes <= 12 && d >= 1 && d <= ultimoDia(a, mes);
}

function emDias(s: string): number {
  const m = DATA.exec(s)!;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / DIA_MS;
}

export function diasEntre(de: string, ate: string): number {
  return emDias(ate) - emDias(de);
}

function mesInteiro(ano: number, mes: number) {
  return {
    de: iso(ano, mes, 1),
    ate: iso(ano, mes, ultimoDia(ano, mes)),
    rotulo: `${MESES[mes - 1]} de ${ano}`,
  };
}

function deslocarMes(ano: number, mes: number, delta: number): [number, number] {
  const idx = ano * 12 + (mes - 1) + delta;
  return [Math.floor(idx / 12), (idx % 12) + 1];
}

function formatoBr(s: string): string {
  const [a, m, d] = s.split("-");
  return `${d}/${m}/${a}`;
}

export function periodoDoFiltro(
  p: { periodo?: string; de?: string; ate?: string },
  agora: Date,
): { filtro: FiltroPeriodo; de: string; ate: string; rotulo: string } {
  const hoje = dataNoFuso(agora);
  const [ano, mes, dia] = hoje.split("-").map(Number);

  switch (p.periodo) {
    case "mes_passado": {
      const [a, m] = deslocarMes(ano, mes, -1);
      return { filtro: "mes_passado", ...mesInteiro(a, m) };
    }
    case "proximo_mes": {
      const [a, m] = deslocarMes(ano, mes, 1);
      return { filtro: "proximo_mes", ...mesInteiro(a, m) };
    }
    case "ano":
      return { filtro: "ano", de: iso(ano, 1, 1), ate: iso(ano, 12, 31), rotulo: String(ano) };
    case "tudo":
      return {
        filtro: "tudo",
        de: "2000-01-01",
        ate: iso(ano + 5, mes, Math.min(dia, ultimoDia(ano + 5, mes))),
        rotulo: "Tudo",
      };
    case "personalizado":
      if (dataValida(p.de) && dataValida(p.ate) && p.de <= p.ate) {
        return {
          filtro: "personalizado",
          de: p.de,
          ate: p.ate,
          rotulo: `${formatoBr(p.de)} a ${formatoBr(p.ate)}`,
        };
      }
      break;
  }
  return { filtro: "mes", ...mesInteiro(ano, mes) };
}

/** Mais de 62 dias (contando os dois extremos) agrupa por mês. */
export function agrupamento(de: string, ate: string): "dia" | "mes" {
  return diasEntre(de, ate) + 1 > 62 ? "mes" : "dia";
}

export function situacaoConta(
  c: { status: "aberta" | "paga" | "cancelada"; vencimento: string },
  hoje: string,
): "paga" | "em_aberto" | "vencida" | "cancelada" {
  if (c.status === "paga") return "paga";
  if (c.status === "cancelada") return "cancelada";
  return c.vencimento < hoje ? "vencida" : "em_aberto";
}

export type ContaAviso = {
  tipo: "pagar" | "receber";
  id: string;
  nome: string;
  valorCentavos: number;
  vencimento: string;
  parcela?: string;
};

const TEXTO_MARCO: Record<number, string> = {
  7: "vence em 7 dias",
  3: "vence em 3 dias",
  1: "vence amanhã",
  0: "vence hoje",
};

export function avisosPendentes(
  contas: ContaAviso[],
  hoje: string,
  lidas: Set<string>,
): { chave: string; texto: string; conta: ContaAviso; dias: number }[] {
  const avisos: { chave: string; texto: string; conta: ContaAviso; dias: number }[] = [];
  for (const conta of contas) {
    const dias = diasEntre(hoje, conta.vencimento);
    let texto: string;
    let chave: string;
    if (dias < 0) {
      const atraso = -dias;
      texto = atraso === 1 ? "vencida há 1 dia" : `vencida há ${atraso} dias`;
      chave = `${conta.tipo}:${conta.id}:vencida:${hoje}`;
    } else if (dias in TEXTO_MARCO) {
      texto = TEXTO_MARCO[dias];
      chave = `${conta.tipo}:${conta.id}:${dias}`;
    } else {
      continue;
    }
    if (lidas.has(chave)) continue;
    avisos.push({ chave, texto, conta, dias });
  }
  return avisos.sort((a, b) => a.conta.vencimento.localeCompare(b.conta.vencimento));
}

/** competencia = AAAA-MM-01. Dia maior que o mês vira o último dia do mês. */
export function vencimentoDaCompetencia(competencia: string, dia: number): string {
  const m = DATA.exec(competencia);
  if (!m) throw new RangeError(`Competência inválida: ${competencia}`);
  const [ano, mes] = [Number(m[1]), Number(m[2])];
  return iso(ano, mes, Math.min(dia, ultimoDia(ano, mes)));
}

/** Último dia do mês seguinte ao de `hoje` (AAAA-MM-DD): até onde as contas fixas são geradas. */
export function fimDoMesSeguinte(hoje: string): string {
  const [ano, mes] = hoje.split("-").map(Number);
  const proximo = mes === 12 ? { ano: ano + 1, mes: 1 } : { ano, mes: mes + 1 };
  return iso(proximo.ano, proximo.mes, ultimoDia(proximo.ano, proximo.mes));
}

/** Máximo de linhas das listas de contas (tela e PDF). */
export const MAX_LINHAS_LISTA = 500;

/** Aviso quando a lista veio cheia (o limite da consulta), ou null. */
export function avisoDoLimite(linhas: number): string | null {
  return linhas >= MAX_LINHAS_LISTA
    ? `Mostrando as ${MAX_LINHAS_LISTA} primeiras — refine o filtro.`
    : null;
}

/** Detalhe de A receber / A pagar: "<base> · inclui <valor> vencidos" quando há parte vencida. */
export function comVencidos(base: string, vencidoCentavos: number, brl: (c: number) => string): string {
  return vencidoCentavos > 0 ? `${base} · inclui ${brl(vencidoCentavos)} vencidos` : base;
}

export function saldos(r: { recebido: number; pago: number; aReceber: number; aPagar: number }): {
  saldoCaixa: number;
  saldoProjetado: number;
} {
  const saldoCaixa = r.recebido - r.pago;
  return { saldoCaixa, saldoProjetado: saldoCaixa + r.aReceber - r.aPagar };
}

export type CategoriaDespesa =
  | "aluguel"
  | "fornecedor"
  | "produto"
  | "salario"
  | "imposto"
  | "vale"
  | "outros";

export const CATEGORIAS_DESPESA: readonly CategoriaDespesa[] = [
  "aluguel",
  "fornecedor",
  "produto",
  "salario",
  "imposto",
  "vale",
  "outros",
];

/** Categorias das contas e contas fixas: `vale` só entra por "Lançar vale". */
export const CATEGORIAS_CONTA: readonly Exclude<CategoriaDespesa, "vale">[] = [
  "aluguel",
  "fornecedor",
  "produto",
  "salario",
  "imposto",
  "outros",
];

export const ROTULO_CATEGORIA: Record<CategoriaDespesa, string> = {
  aluguel: "Aluguel",
  fornecedor: "Fornecedor",
  produto: "Produto",
  salario: "Salário",
  imposto: "Imposto",
  vale: "Vale",
  outros: "Outros",
};

/** Formas de pagamento de uma saída (pagar conta, vale): nunca `a_receber`. */
export const FORMAS_SAIDA = ["pix", "dinheiro", "debito", "credito", "credito_parcelado"] as const;
export type FormaSaida = (typeof FORMAS_SAIDA)[number];

/** Filtro de situação das listas (padrão "aberta"). */
export type FiltroSituacao = "todas" | "aberta" | "vencida" | "paga" | "cancelada";
export const FILTROS_SITUACAO: readonly FiltroSituacao[] = [
  "todas",
  "aberta",
  "vencida",
  "paga",
  "cancelada",
];

export function filtroSituacao(v: string | undefined): FiltroSituacao {
  return FILTROS_SITUACAO.includes(v as FiltroSituacao) ? (v as FiltroSituacao) : "aberta";
}

/**
 * Como cada filtro de situação vira consulta (contas a pagar e a receber):
 * - `aberta`: em aberto com vencimento em [max(de, hoje), ate] (sem as vencidas);
 * - `vencida`: em aberto com vencimento < hoje, de qualquer período (como o cartão Vencidos);
 * - `paga`: pela data do pagamento/recebimento no período;
 * - `cancelada` e `todas`: vencimento no período.
 * `status: null` = qualquer situação.
 */
export function consultaDaSituacao(
  situacao: FiltroSituacao,
  periodo: { de: string; ate: string },
  hoje: string,
): {
  status: "aberta" | "paga" | "cancelada" | null;
  coluna: "vencimento" | "pagamento";
  gte: string | null;
  lte: string | null;
  lt: string | null;
} {
  const { de, ate } = periodo;
  switch (situacao) {
    case "aberta":
      return { status: "aberta", coluna: "vencimento", gte: de > hoje ? de : hoje, lte: ate, lt: null };
    case "vencida":
      return { status: "aberta", coluna: "vencimento", gte: null, lte: null, lt: hoje };
    case "paga":
      return { status: "paga", coluna: "pagamento", gte: de, lte: ate, lt: null };
    case "cancelada":
      return { status: "cancelada", coluna: "vencimento", gte: de, lte: ate, lt: null };
    case "todas":
      return { status: null, coluna: "vencimento", gte: de, lte: ate, lt: null };
  }
}

/**
 * 1º dia do mês em que uma conta fixa nova começa: este mês, ou o próximo se o
 * vencimento deste mês (dia, ou o último dia do mês) já passou.
 */
export function inicioDaContaFixa(dia: number, hoje: string): string {
  const [ano, mes] = hoje.split("-").map(Number);
  if (vencimentoDaCompetencia(iso(ano, mes, 1), dia) >= hoje) return iso(ano, mes, 1);
  const [a, m] = deslocarMes(ano, mes, 1);
  return iso(a, m, 1);
}

/** "2026-11-05" → "05/11/2026"; vazio/null → "—". */
export function dataBr(s: string | null | undefined): string {
  return s ? s.split("-").reverse().join("/") : "—";
}
