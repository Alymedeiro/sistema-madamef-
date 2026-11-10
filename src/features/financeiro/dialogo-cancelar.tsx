"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
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
import { cancelarConta } from "@/app/(app)/financeiro/actions";
import { Campo, CLASSE_TEXTAREA, MensagemErro } from "./formulario";

/** Cancelar conta a pagar ou a receber, com motivo (nada é apagado). Montar só quando aberto. */
export function DialogoCancelar({
  tipo,
  conta,
  onFechar,
}: {
  tipo: "pagar" | "receber";
  conta: { id: string; descricao: string };
  onFechar: () => void;
}) {
  const id = useId();
  const router = useRouter();
  const [motivo, setMotivo] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();

  function confirmar() {
    setErro(null);
    iniciar(async () => {
      const r = await cancelarConta({ tipo, contaId: conta.id, motivo });
      if (!r.ok) {
        setErro(r.erro);
        return;
      }
      toast.success("Conta cancelada.");
      onFechar();
      router.refresh();
    });
  }

  return (
    <Dialog open onOpenChange={(a) => !a && onFechar()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cancelar conta</DialogTitle>
          <DialogDescription>
            {conta.descricao}. A conta continua no histórico como cancelada.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            confirmar();
          }}
        >
          <Campo id={`${id}-motivo`} rotulo="Motivo do cancelamento">
            <textarea
              id={`${id}-motivo`}
              value={motivo}
              maxLength={200}
              rows={3}
              required
              className={CLASSE_TEXTAREA}
              onChange={(e) => setMotivo(e.target.value)}
            />
          </Campo>
          <MensagemErro erro={erro} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onFechar} disabled={pendente}>
              Voltar
            </Button>
            <Button type="submit" variant="destructive" disabled={pendente}>
              {pendente ? "Cancelando…" : "Cancelar conta"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
