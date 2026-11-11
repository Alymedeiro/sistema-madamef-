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
import { recusarPedido } from "@/app/(app)/agenda/pedidos/actions";
import { formatarNoFuso } from "@/lib/dominio/tempo";
import { BotaoWhatsApp, descricaoAviso } from "./botao-whatsapp";
import type { PedidoLista } from "./dados";

/** Recusa com motivo opcional (até 200 caracteres), depois o aviso no WhatsApp. */
export function DialogoRecusar({
  pedido,
  onFechar,
}: {
  pedido: PedidoLista | null;
  onFechar: () => void;
}) {
  return (
    <Dialog open={!!pedido} onOpenChange={(v) => !v && onFechar()}>
      <DialogContent>
        {pedido && <FormularioRecusar key={pedido.id} pedido={pedido} onFechar={onFechar} />}
      </DialogContent>
    </Dialog>
  );
}

function FormularioRecusar({
  pedido,
  onFechar,
}: {
  pedido: PedidoLista;
  onFechar: () => void;
}) {
  const id = useId();
  const [motivo, setMotivo] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [resultado, setResultado] = useState<{ mensagem: string; link: string; naFila: boolean } | null>(null);
  const [pendente, iniciar] = useTransition();

  function enviar() {
    setErro(null);
    iniciar(async () => {
      const r = await recusarPedido({ pedidoId: pedido.id, motivo });
      if (r.ok) {
        toast.success("Pedido recusado. O horário foi liberado.");
        setResultado({ mensagem: r.mensagem, link: r.link, naFila: r.naFila });
      } else {
        setErro(r.erro);
      }
    });
  }

  if (resultado) {
    return (
      <>
        <DialogHeader>
          <DialogTitle>Pedido recusado</DialogTitle>
          <DialogDescription>{descricaoAviso(resultado.naFila)}</DialogDescription>
        </DialogHeader>
        <BotaoWhatsApp link={resultado.link} mensagem={resultado.mensagem} naFila={resultado.naFila} />
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onFechar}>
            Fechar
          </Button>
        </DialogFooter>
      </>
    );
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Recusar pedido</DialogTitle>
        <DialogDescription>
          {pedido.nome ?? "—"} · {pedido.servicoNome} ·{" "}
          {formatarNoFuso(pedido.inicio, "dd/MM 'às' HH:mm")}
        </DialogDescription>
      </DialogHeader>
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          enviar();
        }}
      >
        <div className="flex flex-col gap-2">
          <Label htmlFor={`${id}-motivo`}>Motivo (opcional, só para a equipe)</Label>
          <textarea
            id={`${id}-motivo`}
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            rows={3}
            maxLength={200}
            className="min-h-11 w-full rounded-md border border-input bg-card px-3 py-2 text-base shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring md:text-sm"
          />
        </div>
        {erro && (
          <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
            {erro}
          </p>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onFechar} disabled={pendente}>
            Cancelar
          </Button>
          <Button type="submit" variant="destructive" disabled={pendente}>
            {pendente ? "Recusando…" : "Recusar pedido"}
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}
