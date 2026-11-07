"use client";

import { useId } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import {
  FORMAS_PAGAMENTO,
  formaParcelada,
  gerarParcelas,
  MAX_PARCELAS,
  ROTULO_FORMA,
  type FormaPagamento,
} from "@/lib/dominio/caixa";
import {
  erroDasPartes,
  MAX_PARTES,
  saldoCobranca,
  valorSugeridoNovaParte,
  type ParteCobranca,
} from "@/lib/dominio/cobranca";
import { formatarBRL, parseBRL } from "@/lib/dominio/dinheiro";
import { dataNoFuso } from "@/lib/dominio/tempo";
import { cn } from "@/lib/utils";
import { centavosParaCampo } from "./formato";

/** Uma linha do editor, como a usuária digita (valor em texto). */
export type ParteEditavel = {
  forma: FormaPagamento;
  valor: string;
  parcelas: number;
  primeiroVencimento: string;
};

/** Linha nova com a forma e o valor informados (parcelas 2x e vencimento hoje). */
export function novaParte(forma: FormaPagamento, valorCentavos: number): ParteEditavel {
  return {
    forma,
    valor: centavosParaCampo(valorCentavos),
    parcelas: 2,
    primeiroVencimento: dataNoFuso(new Date()),
  };
}

/** Centavos de cada linha; null quando o texto do valor é inválido. */
export function valoresDasPartes(partes: ParteEditavel[]): (number | null)[] {
  return partes.map((p) => parseBRL(p.valor));
}

/** Linhas → ParteCobranca (valor inválido vira 0; use com saldoCobranca().fecha). */
export function partesEditadasParaCobranca(partes: ParteEditavel[]): ParteCobranca[] {
  return partes.map((p) => ({
    forma: p.forma,
    valorCentavos: parseBRL(p.valor) ?? 0,
    parcelas: formaParcelada(p.forma) ? p.parcelas : 1,
    ...(p.forma === "a_receber" ? { primeiroVencimento: p.primeiroVencimento } : {}),
  }));
}

/** Linhas no formato de entrada das actions (`partesSchema`). */
export function partesParaEnvio(partes: ParteEditavel[]) {
  return partes.map((p) => ({
    forma: p.forma,
    valor: p.valor,
    parcelas: formaParcelada(p.forma) ? p.parcelas : 1,
    primeiroVencimento: p.forma === "a_receber" ? p.primeiroVencimento : undefined,
  }));
}

function previaParcelas(p: ParteEditavel) {
  const valor = parseBRL(p.valor);
  if (valor === null || valor <= 0 || p.parcelas < 2 || p.parcelas > MAX_PARCELAS) return null;
  try {
    return gerarParcelas(valor, p.parcelas, p.primeiroVencimento);
  } catch {
    return null;
  }
}

function LinhaParte({
  indice,
  parte,
  onMudar,
  onRemover,
}: {
  indice: number;
  parte: ParteEditavel;
  onMudar: (p: ParteEditavel) => void;
  onRemover?: () => void;
}) {
  const id = useId();
  const parcelado = formaParcelada(parte.forma);
  const previa = parte.forma === "a_receber" ? previaParcelas(parte) : null;
  const numero = indice + 1;

  return (
    <fieldset
      aria-label={`Forma ${numero}`}
      className="flex flex-col gap-3 rounded-md border p-3"
    >
      <div className="grid grid-cols-[1fr_1fr_auto] items-end gap-3">
        <div className="flex flex-col gap-2">
          <Label htmlFor={`${id}-forma`}>Forma de pagamento</Label>
          <Select
            id={`${id}-forma`}
            value={parte.forma}
            onChange={(e) => onMudar({ ...parte, forma: e.target.value as FormaPagamento })}
          >
            {FORMAS_PAGAMENTO.map((f) => (
              <option key={f} value={f}>
                {ROTULO_FORMA[f]}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor={`${id}-valor`}>Valor</Label>
          <Input
            id={`${id}-valor`}
            inputMode="decimal"
            placeholder="0,00"
            value={parte.valor}
            onChange={(e) => onMudar({ ...parte, valor: e.target.value })}
          />
        </div>
        {onRemover ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`Remover forma ${numero}`}
            onClick={onRemover}
          >
            <Trash2 aria-hidden />
          </Button>
        ) : (
          <span className="size-11" aria-hidden />
        )}
      </div>

      {parcelado && (
        <div className="flex flex-col gap-2">
          <Label htmlFor={`${id}-parcelas`}>Número de parcelas</Label>
          <Select
            id={`${id}-parcelas`}
            value={parte.parcelas}
            onChange={(e) => onMudar({ ...parte, parcelas: Number(e.target.value) })}
          >
            {Array.from({ length: MAX_PARCELAS - 1 }, (_, i) => i + 2).map((n) => (
              <option key={n} value={n}>
                {n}x
              </option>
            ))}
          </Select>
        </div>
      )}

      {parte.forma === "a_receber" && (
        <div className="flex flex-col gap-2">
          <Label htmlFor={`${id}-venc`}>Primeiro vencimento</Label>
          <Input
            id={`${id}-venc`}
            type="date"
            min={dataNoFuso(new Date())}
            value={parte.primeiroVencimento}
            onChange={(e) => onMudar({ ...parte, primeiroVencimento: e.target.value })}
          />
          {previa && (
            <ul className="text-sm text-muted-foreground" aria-label={`Prévia das parcelas da forma ${numero}`}>
              {previa.map((p) => (
                <li key={p.numero}>
                  {p.numero}ª: {formatarBRL(p.valorCentavos)} em{" "}
                  {p.vencimento.split("-").reverse().join("/")}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </fieldset>
  );
}

/**
 * Editor das formas de uma cobrança (1 a 4). Genérico: recebe só o líquido a
 * distribuir; usado no pagamento do atendimento e na venda de pacote.
 */
export function EditorPartes({
  liquidoCentavos,
  partes,
  onMudar,
}: {
  liquidoCentavos: number;
  partes: ParteEditavel[];
  onMudar: (p: ParteEditavel[]) => void;
}) {
  const valores = valoresDasPartes(partes);
  const saldo = saldoCobranca(liquidoCentavos, valores);

  function adicionar() {
    const usadas = new Set(partes.map((p) => p.forma));
    const forma = FORMAS_PAGAMENTO.find((f) => !usadas.has(f)) ?? "pix";
    onMudar([...partes, novaParte(forma, valorSugeridoNovaParte(liquidoCentavos, valores))]);
  }

  let rodape: { texto: string; tom: "ok" | "aviso" };
  // Valor fechado ainda pode ter outra regra quebrada (parcelas, vencimento...).
  const problema = saldo.fecha ? erroDasPartes(liquidoCentavos, partesEditadasParaCobranca(partes)) : null;
  if (saldo.fecha && problema) rodape = { texto: problema, tom: "aviso" };
  else if (saldo.fecha) rodape = { texto: "Valor fechado", tom: "ok" };
  else if (saldo.sobraCentavos > 0) rodape = { texto: `Sobra ${formatarBRL(saldo.sobraCentavos)}`, tom: "aviso" };
  else if (saldo.faltaCentavos > 0) rodape = { texto: `Falta ${formatarBRL(saldo.faltaCentavos)}`, tom: "aviso" };
  else rodape = { texto: "Confira os valores informados.", tom: "aviso" };

  return (
    <div className="flex flex-col gap-3">
      {partes.map((p, i) => (
        <LinhaParte
          key={i}
          indice={i}
          parte={p}
          onMudar={(nova) => onMudar(partes.map((x, j) => (j === i ? nova : x)))}
          onRemover={i > 0 ? () => onMudar(partes.filter((_, j) => j !== i)) : undefined}
        />
      ))}

      {partes.length < MAX_PARTES && (
        <Button
          type="button"
          variant="outline"
          className="self-start"
          onClick={adicionar}
          disabled={saldo.faltaCentavos === 0}
        >
          + Adicionar outra forma
        </Button>
      )}

      <p
        role="status"
        aria-live="polite"
        data-testid="saldo-cobranca"
        className={cn(
          "rounded-md border p-3 text-sm font-medium",
          rodape.tom === "ok" ? "border-emerald-700/40 bg-emerald-50 text-emerald-800" : "bg-blush",
        )}
      >
        {rodape.texto}
      </p>
    </div>
  );
}
