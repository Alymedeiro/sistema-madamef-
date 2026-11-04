// Cobrança com pagamento dividido: 1 a 4 partes (formas) cuja soma é o
// total com desconto. Valores sempre em centavos inteiros. As mensagens são as
// mesmas do banco (registrar_cobranca), para a tela e o servidor falarem igual.

import { formaParcelada, gerarParcelas, MAX_PARCELAS, type FormaPagamento } from "./caixa";

export const MAX_PARTES = 4;

export type ParteCobranca = {
  forma: FormaPagamento;
  valorCentavos: number;
  parcelas: number;
  primeiroVencimento?: string;
};

/** Formato de cada item de `p_partes` em registrar_cobranca / vender_pacote. */
export type PartePagamentoRpc = {
  forma: FormaPagamento;
  valor_centavos: number;
  parcelas: number;
  vencimentos: string[] | null;
  valores_parcelas: number[] | null;
};

export const MENSAGEM_QTD_PARTES = `Informe de 1 a ${MAX_PARTES} formas de pagamento.`;
export const MENSAGEM_PARTE_ZERO = "Cada forma de pagamento deve ter valor maior que zero.";
export const MENSAGEM_SOMA_PARTES =
  "A soma das formas de pagamento deve ser igual ao total com desconto.";
export const MENSAGEM_PARCELAS = `Informe de 2 a ${MAX_PARCELAS} parcelas.`;
export const MENSAGEM_VENCIMENTO = "Informe o primeiro vencimento.";

const DATA = /^(\d{4})-(\d{2})-(\d{2})$/;

/** "AAAA-MM-DD" que existe no calendário. */
function dataExiste(data: string | undefined): data is string {
  const m = data ? DATA.exec(data) : null;
  if (!m) return false;
  const [ano, mes, dia] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const d = new Date(Date.UTC(ano, mes - 1, dia));
  return d.getUTCFullYear() === ano && d.getUTCMonth() === mes - 1 && d.getUTCDate() === dia;
}

/**
 * Quanto já foi distribuído entre as partes e quanto falta/sobra. Um campo
 * inválido (`null`) conta 0 e impede `fecha`, mesmo que o resto bata.
 */
export function saldoCobranca(
  liquidoCentavos: number,
  valoresCentavos: (number | null)[],
): { pagoCentavos: number; faltaCentavos: number; sobraCentavos: number; fecha: boolean } {
  const pagoCentavos = valoresCentavos.reduce<number>((soma, v) => soma + (v ?? 0), 0);
  const algumInvalido = valoresCentavos.some((v) => v === null);
  return {
    pagoCentavos,
    faltaCentavos: Math.max(0, liquidoCentavos - pagoCentavos),
    sobraCentavos: Math.max(0, pagoCentavos - liquidoCentavos),
    fecha: valoresCentavos.length > 0 && !algumInvalido && pagoCentavos === liquidoCentavos,
  };
}

/** Valor que uma nova linha recebe: o que ainda falta (nunca negativo). */
export function valorSugeridoNovaParte(
  liquidoCentavos: number,
  valoresCentavos: (number | null)[],
): number {
  return saldoCobranca(liquidoCentavos, valoresCentavos).faltaCentavos;
}

/** Primeira regra quebrada pelas partes, ou null quando a cobrança fecha. */
export function erroDasPartes(liquidoCentavos: number, partes: ParteCobranca[]): string | null {
  if (partes.length < 1 || partes.length > MAX_PARTES) return MENSAGEM_QTD_PARTES;
  for (const p of partes) {
    if (!Number.isInteger(p.valorCentavos) || p.valorCentavos <= 0) return MENSAGEM_PARTE_ZERO;
    if (
      formaParcelada(p.forma) &&
      (!Number.isInteger(p.parcelas) || p.parcelas < 2 || p.parcelas > MAX_PARCELAS)
    ) {
      return MENSAGEM_PARCELAS;
    }
    if (p.forma === "a_receber" && !dataExiste(p.primeiroVencimento)) return MENSAGEM_VENCIMENTO;
  }
  const soma = partes.reduce((s, p) => s + p.valorCentavos, 0);
  if (soma !== liquidoCentavos) return MENSAGEM_SOMA_PARTES;
  return null;
}

/**
 * Partes no formato da RPC. "A receber" leva vencimentos e valores de
 * `gerarParcelas` (somam exatamente a parte); formas não parceladas vão com 1
 * parcela. Supõe partes já aprovadas por `erroDasPartes`.
 */
export function partesParaRpc(partes: ParteCobranca[]): PartePagamentoRpc[] {
  return partes.map((p) => {
    const parcelas = formaParcelada(p.forma) ? p.parcelas : 1;
    if (p.forma === "a_receber") {
      const lista = gerarParcelas(p.valorCentavos, parcelas, p.primeiroVencimento!);
      return {
        forma: p.forma,
        valor_centavos: p.valorCentavos,
        parcelas,
        vencimentos: lista.map((x) => x.vencimento),
        valores_parcelas: lista.map((x) => x.valorCentavos),
      };
    }
    return {
      forma: p.forma,
      valor_centavos: p.valorCentavos,
      parcelas,
      vencimentos: null,
      valores_parcelas: null,
    };
  });
}
