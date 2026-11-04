"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { cancelarPacote } from "@/app/(app)/clientes/ficha/pacotes";
import type { PacoteFicha } from "@/app/(app)/clientes/ficha/dados";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatarBRL } from "@/lib/dominio/dinheiro";
import { ROTULO_STATUS_PACOTE } from "@/lib/dominio/pacotes";
import { DialogoVendaPacote, type ServicoVenda } from "./dialogo-venda-pacote";

function dataCurta(data: string): string {
  return data.split("-").reverse().join("/");
}

function CartaoPacote({
  pacote: p,
  podeCancelar,
  onCancelar,
}: {
  pacote: PacoteFicha;
  podeCancelar: boolean;
  onCancelar: () => void;
}) {
  return (
    <li className="flex flex-col gap-3 rounded-xl border bg-card p-4 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <p className="font-medium">{p.servicoNome}</p>
        <Badge variant={p.status === "ativo" ? "default" : "secondary"}>
          {ROTULO_STATUS_PACOTE[p.status]}
        </Badge>
        <span className="ml-auto text-muted-foreground">{formatarBRL(p.valorTotalCentavos)}</span>
      </div>
      <div className="flex flex-col gap-1">
        <div
          role="progressbar"
          aria-label={`Sessões usadas de ${p.servicoNome}`}
          aria-valuemin={0}
          aria-valuemax={p.totalSessoes}
          aria-valuenow={p.sessoesUsadas}
          className="h-2 w-full overflow-hidden rounded-full bg-muted"
        >
          <div className="h-full bg-ouro-escuro" style={{ width: `${p.percentual}%` }} />
        </div>
        <p className="text-muted-foreground">
          {p.sessoesUsadas}/{p.totalSessoes} sessões usadas · restam {p.restantes}
        </p>
      </div>
      <p className="text-muted-foreground">
        {p.validade ? `Validade: ${dataCurta(p.validade)}` : "Sem validade"}
      </p>
      {podeCancelar && p.status === "ativo" ? (
        <Button type="button" variant="outline" className="self-start" onClick={onCancelar}>
          Cancelar pacote
        </Button>
      ) : null}
    </li>
  );
}

function ConfirmarCancelamento({
  pacote,
  onFechar,
}: {
  pacote: PacoteFicha | null;
  onFechar: () => void;
}) {
  const router = useRouter();
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();

  function confirmar() {
    if (!pacote) return;
    setErro(null);
    iniciar(async () => {
      const r = await cancelarPacote(pacote.id);
      if (r.ok) {
        toast.success("Pacote cancelado.");
        onFechar();
        router.refresh();
      } else setErro(r.erro);
    });
  }

  return (
    <Dialog open={!!pacote} onOpenChange={(aberto) => !aberto && onFechar()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cancelar pacote?</DialogTitle>
          <DialogDescription>
            {pacote?.servicoNome}: as {pacote?.restantes} sessões restantes deixam de valer. O
            pagamento já lançado no caixa não é alterado.
          </DialogDescription>
        </DialogHeader>
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
            Manter pacote
          </Button>
          <Button type="button" variant="destructive" onClick={confirmar} disabled={pendente}>
            Cancelar pacote
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function AbaPacotes({
  clienteId,
  clienteNome,
  pacotes,
  servicos,
  podeVender,
  podeCancelar,
}: {
  clienteId: string;
  clienteNome: string;
  pacotes: PacoteFicha[];
  servicos: ServicoVenda[];
  podeVender: boolean;
  podeCancelar: boolean;
}) {
  const [vendendo, setVendendo] = useState(false);
  const [cancelando, setCancelando] = useState<PacoteFicha | null>(null);

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      {podeVender ? (
        <Button type="button" className="self-start" onClick={() => setVendendo(true)}>
          Vender pacote
        </Button>
      ) : null}

      {pacotes.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhum pacote vendido.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {pacotes.map((p) => (
            <CartaoPacote
              key={p.id}
              pacote={p}
              podeCancelar={podeCancelar}
              onCancelar={() => setCancelando(p)}
            />
          ))}
        </ul>
      )}

      {podeVender ? (
        <DialogoVendaPacote
          aberto={vendendo}
          clienteId={clienteId}
          clienteNome={clienteNome}
          servicos={servicos}
          onFechar={() => setVendendo(false)}
        />
      ) : null}
      <ConfirmarCancelamento pacote={cancelando} onFechar={() => setCancelando(null)} />
    </div>
  );
}
