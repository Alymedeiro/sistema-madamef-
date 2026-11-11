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
import { pagarComissoes } from "@/app/(app)/financeiro/actions-comissoes";
import { Campo, MensagemErro, OpcoesFormaSaida } from "@/features/financeiro/formulario";
import { formatarBRL } from "@/lib/dominio/dinheiro";
import { formatarCompetencia } from "@/lib/dominio/estoque";
import type { FormaSaida } from "@/lib/dominio/financeiro";

export type ComissoesAPagar = {
  profissionalId: string;
  nome: string;
  /** AAAA-MM-01. */
  competencia: string;
  totalCentavos: number;
};

/** "Pagar comissões" da profissional no mês: data (padrão hoje) e forma (sem "A receber"). */
export function DialogoPagarComissoes({
  item,
  hoje,
  onFechar,
}: {
  item: ComissoesAPagar;
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
      const r = await pagarComissoes({
        profissionalId: item.profissionalId,
        competencia: item.competencia,
        pagoEm,
        forma,
      });
      if (!r.ok) {
        setErro(r.erro);
        return;
      }
      toast.success("Comissões pagas.");
      onFechar();
      router.refresh();
    });
  }

  return (
    <Dialog open onOpenChange={(a) => !a && onFechar()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Pagar comissões</DialogTitle>
          <DialogDescription>
            {item.nome} — {formatarCompetencia(item.competencia)}
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            confirmar();
          }}
        >
          <p className="rounded-md bg-muted p-3 text-sm">
            Total a pagar:{" "}
            <span className="font-semibold tabular-nums" data-testid="total-comissoes">
              {formatarBRL(item.totalCentavos)}
            </span>
            <span className="mt-1 block text-xs text-muted-foreground">
              Lança uma despesa de salário já paga e marca as comissões em aberto do mês como pagas.
            </span>
          </p>
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

/** Botão da linha do resumo que abre o diálogo (montado só quando aberto). */
export function BotaoPagarComissoes({ item, hoje }: { item: ComissoesAPagar; hoje: string }) {
  const [aberto, setAberto] = useState(false);
  return (
    <>
      <Button type="button" size="sm" onClick={() => setAberto(true)}>
        Pagar comissões
      </Button>
      {aberto && <DialogoPagarComissoes item={item} hoje={hoje} onFechar={() => setAberto(false)} />}
    </>
  );
}
