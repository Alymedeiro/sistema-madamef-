import Link from "next/link";
import { cn } from "@/lib/utils";

export const ABAS_CRM = [
  { aba: "retorno", rotulo: "Retorno" },
  { aba: "sumidas", rotulo: "Sumidas" },
  { aba: "leads", rotulo: "Leads" },
  { aba: "aniversariantes", rotulo: "Aniversariantes" },
] as const;

export type AbaCrm = (typeof ABAS_CRM)[number]["aba"];

/** Aba pedida em `?aba=`; inválida ou ausente cai em `retorno`. */
export function abaDoCrm(pedida: string | undefined): AbaCrm {
  return ABAS_CRM.find((a) => a.aba === pedida)?.aba ?? "retorno";
}

export function AbasCrm({ atual }: { atual: AbaCrm }) {
  return (
    <nav aria-label="Seções do CRM" className="-mx-1 max-w-full overflow-x-auto">
      <ul className="flex w-max gap-1 rounded-lg bg-muted p-1">
        {ABAS_CRM.map((a) => (
          <li key={a.aba}>
            <Link
              href={`/crm?aba=${a.aba}`}
              aria-current={a.aba === atual ? "page" : undefined}
              className={cn(
                "inline-flex min-h-11 items-center rounded-md px-4 text-sm font-medium whitespace-nowrap text-muted-foreground sm:px-6",
                a.aba === atual && "bg-card text-foreground shadow-sm",
              )}
            >
              {a.rotulo}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
