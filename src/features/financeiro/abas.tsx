import type { ReactNode } from "react";
import Link from "next/link";
import type { FiltroPeriodo } from "@/lib/dominio/financeiro";
import { ROTULO_ABA_FINANCEIRO, type AbaFinanceiro } from "@/lib/dominio/permissoes";
import { cn } from "@/lib/utils";
import { hrefFinanceiro } from "./url";

/**
 * Abas do Financeiro em pílulas (links que mantêm o período). `children` fica à
 * direita: filtros da lista da aba (situação, busca), quando houver.
 */
export function AbasFinanceiro({
  abas,
  atual,
  periodo,
  de,
  ate,
  children,
}: {
  abas: AbaFinanceiro[];
  atual: AbaFinanceiro;
  periodo: FiltroPeriodo;
  de: string;
  ate: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <nav aria-label="Seções do financeiro" className="-mx-1 max-w-full overflow-x-auto">
        <ul className="flex w-max gap-1 rounded-full bg-muted p-1">
          {abas.map((aba) => (
            <li key={aba}>
              <Link
                href={hrefFinanceiro({ aba, periodo, de, ate })}
                aria-current={aba === atual ? "page" : undefined}
                className={cn(
                  "inline-flex min-h-11 items-center rounded-full px-4 text-sm font-medium whitespace-nowrap",
                  aba === atual
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {ROTULO_ABA_FINANCEIRO[aba]}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}

/** Conteúdo de uma aba ainda sem lançamentos para mostrar. */
export function AbaVazia({ titulo, texto }: { titulo: string; texto: string }) {
  return (
    <section
      aria-label={titulo}
      className="flex flex-col items-center gap-1 rounded-xl border border-dashed bg-card p-8 text-center"
    >
      <h2 className="font-titulo text-lg font-semibold text-ouro-escuro">{titulo}</h2>
      <p className="text-sm text-muted-foreground">{texto}</p>
    </section>
  );
}
