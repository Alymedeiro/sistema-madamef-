"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { colherAssinaturaTermo } from "@/app/(app)/clientes/ficha/termos";
import { blocosMarkdown } from "@/lib/dominio/termos";
import { CampoAssinatura } from "../campo-assinatura";

type Props = {
  clienteId: string;
  clienteNome: string;
  /** CPF já formatado, ou null. */
  clienteCpf: string | null;
  /** Data de hoje (dd/MM/yyyy), calculada no servidor. */
  hoje: string;
  modelo: { id: string; titulo: string; texto: string };
  agendamentoId: string | null;
  voltarPara: string;
};

export function TelaTermo({
  clienteId,
  clienteNome,
  clienteCpf,
  hoje,
  modelo,
  agendamentoId,
  voltarPara,
}: Props) {
  const router = useRouter();
  const [assinatura, setAssinatura] = useState<string | null>(null);
  const [aceite, setAceite] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();

  function confirmar() {
    if (!aceite) {
      setErro('Marque "Li e concordo" para assinar.');
      return;
    }
    if (!assinatura) {
      setErro("Assine no quadro antes de confirmar.");
      return;
    }
    setErro(null);
    iniciar(async () => {
      const r = await colherAssinaturaTermo({
        clienteId,
        modeloTermoId: modelo.id,
        agendamentoId,
        assinatura,
        dispositivo: navigator.userAgent,
        aceite,
      });
      if (!r.ok) {
        setErro(r.erro);
        toast.error(r.erro);
        return;
      }
      toast.success("Termo assinado.");
      router.push(voltarPara);
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3 rounded-2xl border bg-card p-6 shadow-sm">
        {blocosMarkdown(modelo.texto).map((b, i) =>
          b.tipo === "titulo" ? (
            <h2 key={i} className="mt-2 text-2xl font-semibold">
              {b.texto}
            </h2>
          ) : b.tipo === "item" ? (
            <p key={i} className="flex gap-3 pl-2 break-words">
              <span aria-hidden>•</span>
              <span>{b.texto}</span>
            </p>
          ) : (
            <p key={i} className="break-words">
              {b.texto}
            </p>
          ),
        )}
      </section>

      <section className="flex flex-col gap-4 rounded-2xl border bg-card p-6 shadow-sm">
        <dl className="grid gap-2 sm:grid-cols-2">
          <div>
            <dt className="text-base text-muted-foreground">Cliente</dt>
            <dd className="font-medium break-words">{clienteNome}</dd>
          </div>
          {clienteCpf ? (
            <div>
              <dt className="text-base text-muted-foreground">CPF</dt>
              <dd className="font-medium">{clienteCpf}</dd>
            </div>
          ) : null}
          <div>
            <dt className="text-base text-muted-foreground">Data</dt>
            <dd className="font-medium">{hoje}</dd>
          </div>
        </dl>

        <div className="flex flex-col gap-2">
          <h3 className="text-xl font-semibold">Assinatura</h3>
          <CampoAssinatura onMudar={setAssinatura} />
        </div>

        <label
          htmlFor="termo-aceite"
          className="flex min-h-14 cursor-pointer items-center gap-4 rounded-lg border px-4"
        >
          <Checkbox
            id="termo-aceite"
            className="size-7"
            checked={aceite}
            onCheckedChange={(v) => {
              setErro(null);
              setAceite(v === true);
            }}
          />
          <span className="text-xl font-medium">Li e concordo</span>
        </label>

        {erro ? (
          <p role="alert" className="text-lg font-medium text-destructive">
            {erro}
          </p>
        ) : null}
      </section>

      <Button
        type="button"
        className="min-h-14 text-xl"
        disabled={pendente}
        onClick={confirmar}
      >
        {pendente ? "Salvando…" : "Confirmar"}
      </Button>
    </div>
  );
}
