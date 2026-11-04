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
