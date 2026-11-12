"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { Bell, Settings } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { marcarAvisosLidos } from "@/features/avisos/actions";
import type { AvisoItem } from "@/features/avisos/dados";
import { contagemBadge, MAX_AVISOS_POR_VEZ, textoAviso } from "@/features/avisos/texto";
import { cn } from "@/lib/utils";
import { useNotificacoes } from "./provedor";
import { quandoNotificacao } from "./regras";

/**
 * Sininho do topo (todos os perfis): notificações em tempo real e, para a
 * dona, os avisos de contas vencendo. Contador de não lidas, clicar abre o
 * link e marca como lida, "Marcar todas como lidas".
 */
export function Sininho({ avisos = [] }: { avisos?: AvisoItem[] }) {
  const { notificacoes, naoLidas, marcarLidas, abrir } = useNotificacoes();
  const [aberto, setAberto] = useState(false);
  const [pendente, iniciar] = useTransition();
  const caixa = useRef<HTMLDivElement>(null);
  const total = naoLidas + avisos.length;

  useEffect(() => {
    if (!aberto) return;
    const fora = (e: PointerEvent) => {
      if (caixa.current && !caixa.current.contains(e.target as Node)) setAberto(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setAberto(false);
    };
    document.addEventListener("pointerdown", fora);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", fora);
      document.removeEventListener("keydown", esc);
    };
  }, [aberto]);

  function marcarTodas() {
    iniciar(async () => {
      const [rAvisos, okNotificacoes] = await Promise.all([
        avisos.length
          ? marcarAvisosLidos(avisos.slice(0, MAX_AVISOS_POR_VEZ).map((a) => a.chave))
          : Promise.resolve({ ok: true as const }),
        naoLidas > 0 ? marcarLidas(null) : Promise.resolve(true),
      ]);
      if (!rAvisos.ok) toast.error(rAvisos.erro);
      else if (!okNotificacoes) toast.error("Não foi possível marcar as notificações. Tente novamente.");
    });
  }

  return (
    <div className="relative" ref={caixa}>
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="relative size-11"
        aria-label={total ? `Avisos: ${total} não lidos` : "Avisos: nenhum não lido"}
        aria-expanded={aberto}
        onClick={() => setAberto((v) => !v)}
      >
        <Bell aria-hidden />
        {total > 0 && (
          <span
            aria-hidden
            className="absolute -right-1 -top-1 flex min-w-5 items-center justify-center rounded-full bg-destructive px-1 text-xs font-semibold text-white"
          >
            {contagemBadge(total)}
          </span>
        )}
      </Button>
      {aberto && (
        <div
          role="region"
          aria-label="Notificações"
          className="absolute right-0 top-12 z-30 flex max-h-[70dvh] w-[min(24rem,calc(100vw-2rem))] flex-col gap-2 overflow-y-auto rounded-xl border bg-card p-3 shadow-lg"
        >
          {notificacoes.length === 0 && avisos.length === 0 ? (
            <p className="p-2 text-sm text-muted-foreground">Nenhuma notificação.</p>
          ) : (
            <>
              {notificacoes.length > 0 && (
                <ul className="flex flex-col divide-y" aria-label="Notificações recentes">
                  {notificacoes.map((n) => (
                    <li key={n.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setAberto(false);
                          abrir(n);
                        }}
                        className={cn(
                          "flex min-h-11 w-full flex-col items-start gap-0.5 rounded-md px-1 py-2 text-left text-sm hover:bg-accent/50",
                          !n.lida_em && "font-semibold",
                        )}
                      >
                        <span className="flex w-full items-start gap-2">
                          {!n.lida_em && (
                            <span aria-hidden className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" />
                          )}
                          <span className="min-w-0 break-words">
                            {n.titulo}
                            {!n.lida_em && <span className="sr-only"> (não lida)</span>}
                          </span>
                        </span>
                        {n.corpo && (
                          <span className="w-full break-words font-normal text-muted-foreground">{n.corpo}</span>
                        )}
                        <span className="text-xs font-normal text-muted-foreground">
                          {quandoNotificacao(n.criada_em)}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {avisos.length > 0 && (
                <div role="region" aria-label="Avisos de vencimento" className="flex flex-col gap-1">
                  <p className="px-1 pt-1 text-xs font-semibold uppercase text-muted-foreground">Contas</p>
                  <ul className="flex flex-col divide-y">
                    {avisos.map((a) => (
                      <li key={a.chave}>
                        <Link
                          href={a.href}
                          onClick={() => setAberto(false)}
                          className="flex min-h-11 items-center px-1 py-2 text-sm hover:bg-accent/50"
                        >
                          {textoAviso(a.conta, a.texto)}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {total > 0 && (
                <Button type="button" variant="outline" className="min-h-11" disabled={pendente} onClick={marcarTodas}>
                  Marcar todas como lidas
                </Button>
              )}
            </>
          )}
          <Link
            href="/perfil/notificacoes"
            onClick={() => setAberto(false)}
            className="flex min-h-11 items-center justify-center gap-2 rounded-md text-sm text-muted-foreground hover:bg-accent/50"
          >
            <Settings className="size-4" aria-hidden />
            Preferências de notificação
          </Link>
        </div>
      )}
    </div>
  );
}
