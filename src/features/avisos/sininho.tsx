"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Bell } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { formatarBRL } from "@/lib/dominio/dinheiro";
import { marcarAvisosLidos } from "./actions";
import type { AvisoItem } from "./dados";

/** Texto do aviso: "Aluguel — R$ 3.500,00 — vence em 3 dias" (com a parcela, quando houver). */
export function textoAviso(a: AvisoItem): string {
  const partes = [a.conta.nome];
  if (a.conta.parcela) partes.push(a.conta.parcela);
  partes.push(formatarBRL(a.conta.valorCentavos), a.texto);
  return partes.join(" — ");
}

export const contagemBadge = (n: number) => (n > 9 ? "9+" : String(n));

/** Sininho do topo (só a dona): contador, lista e "Marcar todos como lidos". */
export function Sininho({ avisos }: { avisos: AvisoItem[] }) {
  const [aberto, setAberto] = useState(false);
  const [pendente, iniciar] = useTransition();

  function marcarTodos() {
    iniciar(async () => {
      const r = await marcarAvisosLidos(avisos.map((a) => a.chave));
      if (!r.ok) toast.error(r.erro);
    });
  }

  return (
    <div className="relative">
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="relative size-11"
        aria-label={avisos.length ? `Avisos: ${avisos.length} não lidos` : "Avisos: nenhum não lido"}
        aria-expanded={aberto}
        onClick={() => setAberto((v) => !v)}
      >
        <Bell aria-hidden />
        {avisos.length > 0 && (
          <span
            aria-hidden
            className="absolute -right-1 -top-1 flex min-w-5 items-center justify-center rounded-full bg-destructive px-1 text-xs font-semibold text-white"
          >
            {contagemBadge(avisos.length)}
          </span>
        )}
      </Button>
      {aberto && (
        <div
          role="region"
          aria-label="Avisos de vencimento"
          className="absolute right-0 top-12 z-30 flex max-h-[70dvh] w-[min(22rem,calc(100vw-2rem))] flex-col gap-2 overflow-y-auto rounded-xl border bg-card p-3 shadow-lg"
        >
          {avisos.length === 0 ? (
            <p className="p-2 text-sm text-muted-foreground">Nenhum aviso novo.</p>
          ) : (
            <>
              <ul className="flex flex-col divide-y">
                {avisos.map((a) => (
                  <li key={a.chave}>
                    <Link
                      href={a.href}
                      onClick={() => setAberto(false)}
                      className="flex min-h-11 items-center py-2 text-sm hover:bg-accent/50"
                    >
                      {textoAviso(a)}
                    </Link>
                  </li>
                ))}
              </ul>
              <Button type="button" variant="outline" disabled={pendente} onClick={marcarTodos}>
                Marcar todos como lidos
              </Button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
