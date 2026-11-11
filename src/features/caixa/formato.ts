import { resumoCaixa, type FormaPagamento, type ResumoCaixa } from "@/lib/dominio/caixa";
import { formatarBRL } from "@/lib/dominio/dinheiro";

/** 18000 -> "180,00" (sem "R$", para campos de entrada). */
export function centavosParaCampo(centavos: number): string {
  return (centavos / 100).toFixed(2).replace(".", ",");
}

export type TomDiferenca = "neutro" | "sobra" | "falta";

/** Diferença do fechamento com sinal e rótulo: "+R$ 3,00 (sobrou)", "-R$ 3,00 (faltou)". */
export function descreverDiferenca(centavos: number): { texto: string; tom: TomDiferenca } {
  if (centavos === 0) return { texto: `${formatarBRL(0)} (confere)`, tom: "neutro" };
  if (centavos > 0) return { texto: `+${formatarBRL(centavos)} (sobrou)`, tom: "sobra" };
  return { texto: `-${formatarBRL(-centavos)} (faltou)`, tom: "falta" };
}

export const CLASSE_TOM: Record<TomDiferenca, string> = {
  neutro: "text-foreground",
  sobra: "text-emerald-800",
  falta: "text-destructive",
};

/** "2026-11-03" -> "03/11/2026". */
export function dataCurta(data: string): string {
  return data.split("-").reverse().join("/");
}

export type CaixaNaoFechado = {
  id: string;
  data: string;
  valorInicialCentavos: number;
  resumo: ResumoCaixa;
};

/**
 * Caixas de dias anteriores a `hoje` que ninguém fechou (a dona pode fechá-los
 * depois), do mais antigo para o mais recente, com o resumo calculado dos
 * pagamentos e das parcelas recebidas de cada um (como o fechar_caixa).
 */
export function caixasNaoFechados(
  caixas: { id: string; data: string; valor_inicial_centavos: number; fechado_em: string | null }[],
  pagamentos: { caixa_id: string; forma: string; valor_centavos: number; desconto_centavos: number }[],
  hoje: string,
  recebimentos: { caixa_id: string; forma: string; valor_centavos: number }[] = [],
): CaixaNaoFechado[] {
  return caixas
    .filter((c) => c.fechado_em === null && c.data < hoje)
    .sort((a, b) => a.data.localeCompare(b.data))
    .map((c) => ({
      id: c.id,
      data: c.data,
      valorInicialCentavos: c.valor_inicial_centavos,
      resumo: resumoCaixa(
        c.valor_inicial_centavos,
        pagamentos
          .filter((p) => p.caixa_id === c.id)
          .map((p) => ({
            forma: p.forma as FormaPagamento,
            valorCentavos: p.valor_centavos,
            descontoCentavos: p.desconto_centavos,
          })),
        recebimentos
          .filter((r) => r.caixa_id === c.id)
          .map((r) => ({ forma: r.forma as FormaPagamento, valorCentavos: r.valor_centavos })),
      ),
    }));
}
