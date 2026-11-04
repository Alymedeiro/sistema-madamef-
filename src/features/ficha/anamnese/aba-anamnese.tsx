"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { urlAssinaturaAnamnese } from "@/app/(app)/clientes/ficha/anamnese";
import type { AnamneseFicha } from "@/app/(app)/clientes/ficha/dados";
import { formatarNoFuso } from "@/lib/dominio/tempo";

function Itens({ itens }: { itens: AnamneseFicha["itens"] }) {
  return (
    <dl className="grid gap-3 sm:grid-cols-2">
      {itens.map((i, n) => (
        <div key={n}>
          <dt className="text-sm text-muted-foreground">{i.pergunta}</dt>
          <dd className="font-medium break-words whitespace-pre-line">
            {i.alerta && i.resposta.startsWith("Sim") ? "⚠ " : ""}
            {i.resposta}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function VerAssinatura({ id }: { id: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();
  return (
    <div className="flex flex-col gap-2">
      <Button
        type="button"
        variant="outline"
        className="self-start"
        disabled={pendente}
        onClick={() =>
          iniciar(async () => {
            const r = await urlAssinaturaAnamnese(id);
            if (r.ok) setUrl(r.url);
            else toast.error(r.erro);
          })
        }
      >
        Ver assinatura
      </Button>
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element -- URL assinada temporária (5 min)
        <img
          src={url}
          alt="Assinatura da cliente"
          className="max-h-40 w-auto rounded-md border bg-white p-2"
        />
      ) : null}
    </div>
  );
}

function Cabecalho({ a }: { a: AnamneseFicha }) {
  return (
    <p className="text-sm text-muted-foreground">
      {formatarNoFuso(a.preenchidaEm, "dd/MM/yyyy 'às' HH:mm")} · versão {a.versao} ·
      por {a.preenchidaPor}
    </p>
  );
}

export function AbaAnamnese({
  clienteId,
  anamneses,
  podePreencher,
}: {
  clienteId: string;
  anamneses: AnamneseFicha[];
  podePreencher: boolean;
}) {
  const [ultima, ...anteriores] = anamneses;
  return (
    <div className="flex flex-col gap-4">
      {podePreencher ? (
        <Button asChild className="self-start">
          <Link href={`/tablet/anamnese/${clienteId}`}>Preencher anamnese</Link>
        </Button>
      ) : null}

      {!ultima ? (
        <p className="rounded-xl border bg-card p-4 text-muted-foreground">
          Nenhuma anamnese registrada ainda.
        </p>
      ) : (
        <article className="flex flex-col gap-4 rounded-xl border bg-card p-4">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-titulo text-lg font-semibold text-ouro-escuro">
              Anamnese mais recente
            </h2>
            <Badge variant="secondary">Atual</Badge>
          </div>
          <Cabecalho a={ultima} />
          {ultima.alertas.length > 0 ? (
            <div
              role="alert"
              className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm"
            >
              <p className="font-semibold">⚠ Atenção</p>
              <ul className="list-disc pl-5">
                {ultima.alertas.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            </div>
          ) : null}
          <Itens itens={ultima.itens} />
          <VerAssinatura id={ultima.id} />
        </article>
      )}

      {anteriores.length > 0 ? (
        <section aria-label="Versões anteriores" className="flex flex-col gap-2">
          <h2 className="font-titulo text-lg font-semibold text-ouro-escuro">
            Anamneses anteriores
          </h2>
          {anteriores.map((a) => (
            <details key={a.id} className="rounded-xl border bg-card p-4">
              <summary className="min-h-11 cursor-pointer py-2 text-sm font-medium">
                {formatarNoFuso(a.preenchidaEm, "dd/MM/yyyy")} · versão {a.versao}
                {a.alertas.length > 0 ? " · ⚠ Atenção" : ""}
              </summary>
              <div className="mt-3 flex flex-col gap-4">
                <Cabecalho a={a} />
                <Itens itens={a.itens} />
                <VerAssinatura id={a.id} />
              </div>
            </details>
          ))}
        </section>
      ) : null}
    </div>
  );
}
