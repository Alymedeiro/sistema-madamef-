import Link from "next/link";
import { cn } from "@/lib/utils";
import { ROTULO_ABA, type AbaFicha } from "@/lib/dominio/permissoes";

export function AbasFicha({
  clienteId,
  abas,
  atual,
}: {
  clienteId: string;
  abas: AbaFicha[];
  atual: AbaFicha;
}) {
  return (
    <nav aria-label="Seções da ficha" className="-mx-1 overflow-x-auto">
      <ul className="flex w-max min-w-full gap-1 rounded-lg bg-muted p-1">
        {abas.map((aba) => (
          <li key={aba}>
            <Link
              href={`/clientes/${clienteId}?aba=${aba}`}
              aria-current={aba === atual ? "page" : undefined}
              className={cn(
                "inline-flex min-h-11 items-center rounded-md px-4 text-sm font-medium whitespace-nowrap",
                aba === atual
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {ROTULO_ABA[aba]}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
