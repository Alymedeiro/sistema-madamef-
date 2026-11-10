import Link from "next/link";
import type { ProximoVencimento } from "@/app/(app)/financeiro/dados";
import { hrefConta } from "@/features/avisos/link";
import { formatarBRL } from "@/lib/dominio/dinheiro";
import { cn } from "@/lib/utils";

const dataCurta = (s: string) => {
  const [, m, d] = s.split("-");
  return `${d}/${m}`;
};

function quando(vencimento: string, hoje: string, amanha: string): string {
  if (vencimento === hoje) return "hoje";
  if (vencimento === amanha) return "amanhã";
  return dataCurta(vencimento);
}

/** Aba Painel: próximos vencimentos (a pagar e a receber em aberto, 0 a 7 dias). */
export function PainelFinanceiro({
  proximos,
  hoje,
  amanha,
}: {
  proximos: ProximoVencimento[];
  hoje: string;
  amanha: string;
}) {
  return (
    <section aria-labelledby="proximos-t" className="flex flex-col gap-3 rounded-xl border bg-card p-4 shadow-sm">
      <h2 id="proximos-t" className="font-titulo text-lg font-semibold text-ouro-escuro">
        Próximos vencimentos (7 dias)
      </h2>
      {proximos.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhuma conta vencendo nos próximos 7 dias.</p>
      ) : (
        <ul className="flex flex-col divide-y">
          {proximos.map((c) => (
            <li key={`${c.tipo}:${c.id}`}>
              <Link
                href={hrefConta(c.tipo, c.id, 0)}
                className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm hover:bg-accent/50"
              >
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 text-xs font-medium",
                    c.tipo === "pagar" ? "bg-destructive/10 text-destructive" : "bg-secondary text-secondary-foreground",
                  )}
                >
                  {c.tipo === "pagar" ? "A pagar" : "A receber"}
                </span>
                <span className="font-medium">{c.nome}</span>
                {c.detalhe && <span className="text-muted-foreground">{c.detalhe}</span>}
                <span className="ml-auto flex items-center gap-3">
                  <span className="text-muted-foreground">vence {quando(c.vencimento, hoje, amanha)}</span>
                  <span className="font-semibold tabular-nums">{formatarBRL(c.valorCentavos)}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
