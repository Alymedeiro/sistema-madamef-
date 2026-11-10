import type { ReactNode } from "react";
import { Label } from "@/components/ui/label";
import { ROTULO_FORMA } from "@/lib/dominio/caixa";
import { FORMAS_SAIDA } from "@/lib/dominio/financeiro";

// Peças comuns dos diálogos do Financeiro.

export const CLASSE_TEXTAREA =
  "min-h-11 w-full rounded-md border border-input bg-card px-3 py-2 text-base shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring md:text-sm";

export function Campo({ id, rotulo, children }: { id: string; rotulo: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{rotulo}</Label>
      {children}
    </div>
  );
}

export function MensagemErro({ erro }: { erro: string | null }) {
  if (!erro) return null;
  return (
    <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
      {erro}
    </p>
  );
}

/** Opções de forma de pagamento de uma saída (sem "A receber"). */
export function OpcoesFormaSaida() {
  return (
    <>
      {FORMAS_SAIDA.map((f) => (
        <option key={f} value={f}>
          {ROTULO_FORMA[f]}
        </option>
      ))}
    </>
  );
}
