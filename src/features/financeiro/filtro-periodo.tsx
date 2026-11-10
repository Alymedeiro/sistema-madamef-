import Link from "next/link";
import type { FiltroPeriodo } from "@/lib/dominio/financeiro";
import type { AbaFinanceiro } from "@/lib/dominio/permissoes";
import { cn } from "@/lib/utils";
import { hrefFinanceiro } from "./url";

const CHIPS: { periodo: Exclude<FiltroPeriodo, "personalizado">; rotulo: string }[] = [
  { periodo: "mes", rotulo: "Este mês" },
  { periodo: "mes_passado", rotulo: "Mês passado" },
  { periodo: "proximo_mes", rotulo: "Próximo mês" },
  { periodo: "ano", rotulo: "Este ano" },
  { periodo: "tudo", rotulo: "Tudo" },
];

const CHIP =
  "inline-flex min-h-11 cursor-pointer items-center rounded-full border px-4 text-sm font-medium whitespace-nowrap";
const CHIP_ATIVO = "border-primary bg-primary text-primary-foreground";
const CHIP_INATIVO = "bg-card text-foreground hover:bg-accent";

/**
 * Chips de período (estado na URL, sem JavaScript). "Personalizado" abre um
 * formulário GET com de/até; datas inválidas caem em "Este mês".
 */
export function FiltroDePeriodo({
  aba,
  filtro,
  de,
  ate,
  rotulo,
}: {
  aba: AbaFinanceiro;
  filtro: FiltroPeriodo;
  de: string;
  ate: string;
  rotulo: string;
}) {
  const personalizado = filtro === "personalizado";
  return (
    <section aria-label="Período" className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {CHIPS.map((c) => (
          <Link
            key={c.periodo}
            href={hrefFinanceiro({ aba, periodo: c.periodo })}
            aria-current={c.periodo === filtro ? "true" : undefined}
            className={cn(CHIP, c.periodo === filtro ? CHIP_ATIVO : CHIP_INATIVO)}
          >
            {c.rotulo}
          </Link>
        ))}
        <details open={personalizado} className="group">
          <summary
            aria-current={personalizado ? "true" : undefined}
            className={cn(CHIP, "list-none [&::-webkit-details-marker]:hidden", personalizado ? CHIP_ATIVO : CHIP_INATIVO)}
          >
            Personalizado
          </summary>
          <form
            method="get"
            action="/financeiro"
            className="mt-2 flex flex-wrap items-end gap-2 rounded-xl border bg-card p-3"
          >
            {aba !== "painel" && <input type="hidden" name="aba" value={aba} />}
            <input type="hidden" name="periodo" value="personalizado" />
            <label className="flex flex-col gap-1 text-sm">
              De
              <input
                type="date"
                name="de"
                required
                defaultValue={personalizado ? de : undefined}
                className="min-h-11 rounded-md border bg-card px-3"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Até
              <input
                type="date"
                name="ate"
                required
                defaultValue={personalizado ? ate : undefined}
                className="min-h-11 rounded-md border bg-card px-3"
              />
            </label>
            <button
              type="submit"
              className="min-h-11 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-ouro-escuro"
            >
              Aplicar
            </button>
          </form>
        </details>
      </div>
      <p className="text-sm text-muted-foreground" data-testid="periodo-rotulo">
        Período: <span className="font-medium text-foreground">{rotulo}</span>
      </p>
    </section>
  );
}
