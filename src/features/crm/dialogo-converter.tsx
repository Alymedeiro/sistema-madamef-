"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { converterLead } from "@/app/(app)/crm/actions";
import type { Lead } from "@/app/(app)/crm/dados";

type Props = { lead: Lead | null; onFechar: () => void };

/** Converte o lead em cliente: exige o aceite da LGPD e pergunta o opt-in de marketing. */
export function DialogoConverter({ lead, onFechar }: Props) {
  return (
    <Dialog open={lead !== null} onOpenChange={(v) => !v && onFechar()}>
      <DialogContent>{lead && <Conteudo lead={lead} onFechar={onFechar} />}</DialogContent>
    </Dialog>
  );
}

function Conteudo({ lead, onFechar }: { lead: Lead; onFechar: () => void }) {
  const [lgpd, setLgpd] = useState(false);
  const [marketing, setMarketing] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();

  function converter() {
    setErro(null);
    iniciar(async () => {
      const r = await converterLead({ id: lead.id, aceiteLgpd: lgpd, aceitaMarketing: marketing });
      if (!r.ok) {
        setErro(r.erro);
        return;
      }
      toast.success("Lead convertido em cliente.");
      onFechar();
    });
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Converter em cliente</DialogTitle>
        <DialogDescription>
          {lead.nome} vira cliente. Se já existir cliente com o mesmo WhatsApp, o lead é ligado a ela.
        </DialogDescription>
      </DialogHeader>
      <div className="flex flex-col">
        <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
          <Checkbox checked={lgpd} onCheckedChange={(v) => setLgpd(v === true)} />
          <span>A cliente aceitou o tratamento dos dados (LGPD).</span>
        </label>
        <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
          <Checkbox checked={marketing} onCheckedChange={(v) => setMarketing(v === true)} />
          <span>Aceita receber mensagens de marketing no WhatsApp.</span>
        </label>
      </div>
      {erro && (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive"
        >
          {erro}
        </p>
      )}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onFechar} disabled={pendente}>
          Cancelar
        </Button>
        <Button type="button" onClick={converter} disabled={pendente || !lgpd}>
          {pendente ? "Convertendo…" : "Converter"}
        </Button>
      </DialogFooter>
    </>
  );
}
