"use client";

import { useId, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { enviarWhatsAppLead } from "@/app/(app)/crm/actions";
import type { Lead } from "@/app/(app)/crm/dados";
import { LIMITE_TEXTO_AVULSA, MENSAGEM_TEXTO_VAZIO } from "@/app/(app)/mensagens/schemas";
import { textoInicialAvulsa } from "@/features/mensagens/dialogo-enviar";

type Props = { lead: Lead | null; onFechar: () => void };

/** Texto livre para o lead; entra na fila como avulsa pendente. */
export function DialogoWhatsappLead({ lead, onFechar }: Props) {
  return (
    <Dialog open={lead !== null} onOpenChange={(v) => !v && onFechar()}>
      <DialogContent>{lead && <Conteudo lead={lead} onFechar={onFechar} />}</DialogContent>
    </Dialog>
  );
}

function Conteudo({ lead, onFechar }: { lead: Lead; onFechar: () => void }) {
  const id = useId();
  const [texto, setTexto] = useState(() => textoInicialAvulsa(lead.nome));
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();

  function enviar(e: React.FormEvent) {
    e.preventDefault();
    if (!texto.trim()) {
      setErro(MENSAGEM_TEXTO_VAZIO);
      return;
    }
    setErro(null);
    iniciar(async () => {
      const r = await enviarWhatsAppLead({ id: lead.id, texto });
      if (!r.ok) {
        setErro(r.erro);
        return;
      }
      toast.success("Mensagem enviada para a fila.");
      onFechar();
    });
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Enviar WhatsApp</DialogTitle>
        <DialogDescription>
          Para {lead.nome}. A mensagem entra na fila e sai pelo número da clínica.
        </DialogDescription>
      </DialogHeader>
      <form noValidate onSubmit={enviar} className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor={`${id}-texto`}>Mensagem</Label>
          <textarea
            id={`${id}-texto`}
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            rows={6}
            maxLength={LIMITE_TEXTO_AVULSA}
            aria-invalid={!!erro}
            className="min-h-11 w-full rounded-md border border-input bg-card px-3 py-2 text-base shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring aria-invalid:border-destructive md:text-sm"
          />
          <p className="text-xs text-muted-foreground tabular-nums">
            {texto.length}/{LIMITE_TEXTO_AVULSA}
          </p>
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
          <Button type="submit" disabled={pendente}>
            {pendente ? "Enviando…" : "Enviar"}
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}
