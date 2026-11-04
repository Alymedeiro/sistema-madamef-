// Regras puras do caixa (valores sempre em centavos inteiros).

export type FormaPagamento =
  | "pix"
  | "dinheiro"
  | "debito"
  | "credito"
  | "credito_parcelado"
  | "a_receber";

export const FORMAS_PAGAMENTO: readonly FormaPagamento[] = [
  "pix",
  "dinheiro",
  "debito",
  "credito",
  "credito_parcelado",
  "a_receber",
];

export const ROTULO_FORMA: Record<FormaPagamento, string> = {
  pix: "Pix",
  dinheiro: "Dinheiro",
  debito: "Débito",
  credito: "Crédito",
  credito_parcelado: "Crédito parcelado",
  a_receber: "A receber",
};

export const MAX_PARCELAS = 12;

/** Só crédito parcelado e "a receber" têm de 2 a 12 parcelas; as demais têm 1. */
export function formaParcelada(forma: FormaPagamento): boolean {
  return forma === "credito_parcelado" || forma === "a_receber";
}

export type Parcela = { numero: number; valorCentavos: number; vencimento: string };

const DATA = /^(\d{4})-(\d{2})-(\d{2})$/;
const doisDigitos = (n: number) => String(n).padStart(2, "0");
const diasNoMes = (ano: number, mes: number) => new Date(Date.UTC(ano, mes, 0)).getUTCDate();

/**
 * Divide o valor em n parcelas (o resto dos centavos vai para a 1ª) com
 * vencimentos mensais no mesmo dia; se o mês não tem o dia, usa o último dia.
 */
export function gerarParcelas(
  valorCentavos: number,
  n: number,
  primeiroVencimento: string,
): Parcela[] {
  if (!Number.isInteger(valorCentavos) || valorCentavos < 0) {
    throw new RangeError(`Valor inválido: ${valorCentavos}`);
  }
  if (!Number.isInteger(n) || n < 1) {
    throw new RangeError(`Número de parcelas inválido: ${n}`);
  }
  const m = DATA.exec(primeiroVencimento);
  if (!m) throw new RangeError(`Data inválida: ${primeiroVencimento}`);
  const [ano, mes, dia] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (mes < 1 || mes > 12 || dia < 1 || dia > diasNoMes(ano, mes)) {
    throw new RangeError(`Data inválida: ${primeiroVencimento}`);
  }

  const base = Math.floor(valorCentavos / n);
  const resto = valorCentavos - base * n;

  return Array.from({ length: n }, (_, i) => {
    const indiceMes = mes - 1 + i;
    const a = ano + Math.floor(indiceMes / 12);
    const mm = (indiceMes % 12) + 1;
    const d = Math.min(dia, diasNoMes(a, mm));
    return {
      numero: i + 1,
      valorCentavos: i === 0 ? base + resto : base,
      vencimento: `${a}-${doisDigitos(mm)}-${doisDigitos(d)}`,
    };
  });
}

export type LancamentoCaixa = {
  forma: FormaPagamento;
  valorCentavos: number;
  descontoCentavos: number;
};

export type ResumoCaixa = {
  totalPorForma: Record<FormaPagamento, number>;
  /** Inclui "a receber" (ainda não entrou dinheiro). */
  totalGeral: number;
  dinheiroEsperado: number;
};

/** Totais líquidos de desconto; dinheiro esperado = troco inicial + dinheiro recebido. */
export function resumoCaixa(
  valorInicialCentavos: number,
  pagamentos: LancamentoCaixa[],
): ResumoCaixa {
  const totalPorForma = Object.fromEntries(FORMAS_PAGAMENTO.map((f) => [f, 0])) as Record<
    FormaPagamento,
    number
  >;
  let totalGeral = 0;
  for (const p of pagamentos) {
    const liquido = p.valorCentavos - p.descontoCentavos;
    totalPorForma[p.forma] += liquido;
    totalGeral += liquido;
  }
  return {
    totalPorForma,
    totalGeral,
    dinheiroEsperado: valorInicialCentavos + totalPorForma.dinheiro,
  };
}
