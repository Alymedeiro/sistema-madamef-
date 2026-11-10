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
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { pagarConta } from "@/app/(app)/financeiro/actions";
import { formatarBRL } from "@/lib/dominio/dinheiro";
import type { FormaSaida } from "@/lib/dominio/financeiro";
import { Campo, MensagemErro, OpcoesFormaSaida } from "./formulario";

/** "Marcar como paga": data do pagamento e forma (sem "A receber"). Montar só quando aberto. */
export function DialogoPagar({
  conta,
  hoje,
  onFechar,
}: {
  conta: { id: string; descricao: string; valorCentavos: number };
  hoje: string;
  onFechar: () => void;
}) {
  const id = useId();
  const router = useRouter();
  const [pagoEm, setPagoEm] = useState(hoje);
  const [forma, setForma] = useState<FormaSaida>("pix");
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();

  function confirmar() {
    setErro(null);
    iniciar(async () => {
      const r = await pagarConta({ contaId: conta.id, pagoEm, forma });
      if (!r.ok) {
        setErro(r.erro);
        return;
      }
      toast.success("Conta marcada como paga.");
      onFechar();
      router.refresh();
    });
  }

  return (
    <Dialog open onOpenChange={(a) => !a && onFechar()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Marcar como paga</DialogTitle>
          <DialogDescription>
            {conta.descricao} — {formatarBRL(conta.valorCentavos)}
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            confirmar();
          }}
        >
          <Campo id={`${id}-data`} rotulo="Pago em">
            <Input id={`${id}-data`} type="date" value={pagoEm} required onChange={(e) => setPagoEm(e.target.value)} />
          </Campo>
          <Campo id={`${id}-forma`} rotulo="Forma de pagamento">
            <Select id={`${id}-forma`} value={forma} onChange={(e) => setForma(e.target.value as FormaSaida)}>
              <OpcoesFormaSaida />
            </Select>
          </Campo>
          <MensagemErro erro={erro} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onFechar} disabled={pendente}>
              Voltar
            </Button>
            <Button type="submit" disabled={pendente}>
              {pendente ? "Salvando…" : "Confirmar pagamento"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
