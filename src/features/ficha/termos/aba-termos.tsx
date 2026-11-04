"use client";

import { useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { urlArquivoTermo } from "@/app/(app)/clientes/ficha/termos";
import type { TermosFicha } from "@/app/(app)/clientes/ficha/dados";
import { formatarNoFuso } from "@/lib/dominio/tempo";

function AbrirPdf({ id }: { id: string }) {
  const [pendente, iniciar] = useTransition();
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="min-h-11"
      disabled={pendente}
      onClick={() => {
        // A aba abre no clique (antes do await) para o bloqueador de pop-up não barrar.
        const aba = window.open("about:blank", "_blank");
        iniciar(async () => {
          const r = await urlArquivoTermo(id, "pdf");
          if (r.ok && aba) {
            aba.location.href = r.url;
          } else {
            aba?.close();
            toast.error(r.ok ? "Permita pop-ups para abrir o PDF." : r.erro);
          }
        });
      }}
    >
      Abrir PDF
    </Button>
  );
}

export function AbaTermos({
  clienteId,
  termos,
  podeColher,
}: {
  clienteId: string;
  termos: TermosFicha;
  podeColher: boolean;
}) {
  const { assinados, pendentes } = termos;
  return (
    <div className="flex flex-col gap-4">
      {podeColher ? (
        <Button asChild className="self-start">
          <Link href={`/tablet/termo/${clienteId}`}>Colher assinatura de um termo</Link>
        </Button>
      ) : null}

      {pendentes.length > 0 ? (
        <section aria-label="Termos pendentes" className="flex flex-col gap-2">
          <h2 className="font-titulo text-lg font-semibold text-ouro-escuro">Pendentes</h2>
          {pendentes.map((p) => (
            <div
              key={p.modeloTermoId}
              className="flex flex-wrap items-center gap-3 rounded-xl border border-destructive/40 bg-destructive/10 p-4"
            >
              <span className="min-w-0 flex-1 font-medium">{p.titulo}</span>
              <Badge variant="destructive">Pendente</Badge>
              {podeColher ? (
                <Button asChild size="sm" className="min-h-11">
                  <Link href={`/tablet/termo/${clienteId}?modelo=${p.modeloTermoId}`}>
                    Colher assinatura
                  </Link>
                </Button>
              ) : null}
            </div>
          ))}
        </section>
      ) : null}

      <section aria-label="Termos assinados" className="flex flex-col gap-2">
        <h2 className="font-titulo text-lg font-semibold text-ouro-escuro">Assinados</h2>
        {assinados.length === 0 ? (
          <p className="rounded-xl border bg-card p-4 text-muted-foreground">
            Nenhum termo assinado ainda.
          </p>
        ) : (
          assinados.map((t) => (
            <article
              key={t.id}
              className="flex flex-wrap items-center gap-3 rounded-xl border bg-card p-4"
            >
              <div className="min-w-0 flex-1">
                <h3 className="font-medium break-words">{t.titulo}</h3>
                <p className="text-sm text-muted-foreground">
                  {formatarNoFuso(t.assinadoEm, "dd/MM/yyyy 'às' HH:mm")} · versão {t.versao} · por{" "}
                  {t.colhidoPor}
                </p>
              </div>
              {t.atual ? <Badge variant="secondary">Atual</Badge> : null}
              <AbrirPdf id={t.id} />
            </article>
          ))
        )}
      </section>
    </div>
  );
}
