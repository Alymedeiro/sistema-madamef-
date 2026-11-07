import { Button } from "@/components/ui/button";
import { ehCortesia, erroDasPartes, saldoCobranca } from "@/lib/dominio/cobranca";
import {
  partesEditadasParaCobranca,
  partesParaEnvio,
  valoresDasPartes,
  type ParteEditavel,
} from "./editor-partes";

export const ROTULO_CORTESIA = "Cortesia — confirmar sem pagamento";

/**
 * A cobrança pode ser confirmada? Cortesia (líquido zero) não pede forma;
 * nos demais casos as formas têm de fechar o total sem quebrar nenhuma regra.
 */
export function cobrancaPronta(liquidoCentavos: number | null, partes: ParteEditavel[]): boolean {
  if (liquidoCentavos === null) return false;
  if (ehCortesia(liquidoCentavos)) return true;
  return (
    saldoCobranca(liquidoCentavos, valoresDasPartes(partes)).fecha &&
    erroDasPartes(liquidoCentavos, partesEditadasParaCobranca(partes)) === null
  );
}

/** Formas enviadas à action: nenhuma na cortesia. */
export function partesDaCobranca(liquidoCentavos: number, partes: ParteEditavel[]) {
  return ehCortesia(liquidoCentavos) ? [] : partesParaEnvio(partes);
}

/** "Confirmar", ou o rótulo de cortesia quando o total com desconto é zero. */
export function BotaoConfirmarCobranca({
  liquidoCentavos,
  pronto,
  pendente,
}: {
  liquidoCentavos: number | null;
  pronto: boolean;
  pendente: boolean;
}) {
  return (
    <Button type="submit" disabled={pendente || !pronto}>
      {ehCortesia(liquidoCentavos) ? ROTULO_CORTESIA : "Confirmar"}
    </Button>
  );
}
