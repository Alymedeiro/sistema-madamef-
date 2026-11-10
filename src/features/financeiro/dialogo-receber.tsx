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
import { Select } from "@/components/ui/select";
import { receberParcela } from "@/app/(app)/financeiro/actions";
import { formatarBRL } from "@/lib/dominio/dinheiro";
import type { FormaSaida } from "@/lib/dominio/financeiro";
import { Campo, MensagemErro, OpcoesFormaSaida } from "./formulario";

export type ParcelaParaReceber = {
  id: string;
  clienteNome: string;
  parcela: string;
  /** Conta manual: a descrição aparece no lugar de "parcela 1/1". */
  descricao: string | null;
  valorCentavos: number;
};

/** "Maria — Saldo do tratamento — R$ 120,00" ou "Maria — parcela 2/3 — R$ 50,00". */
export function descricaoDoRecebimento(conta: ParcelaParaReceber): string {
  return `${conta.clienteNome} — ${conta.descricao ?? `parcela ${conta.parcela}`} — ${formatarBRL(conta.valorCentavos)}`;
}

/**
 * "Receber" uma parcela: forma de pagamento (sem "A receber"); entra no caixa
 * de hoje, que precisa estar aberto. Montar só quando aberto.
 */
export function DialogoReceber({ conta, onFechar }: { conta: ParcelaParaReceber; onFechar: () => void }) {
  const id = useId();
  const router = useRouter();
  const [forma, setForma] = useState<FormaSaida>("pix");
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();

  function confirmar() {
    setErro(null);
    iniciar(async () => {
      const r = await receberParcela({ contaId: conta.id, forma });
      if (!r.ok) {
        setErro(r.erro);
        return;
      }
      toast.success("Parcela recebida no caixa do dia.");
      onFechar();
      router.refresh();
    });
  }

  return (
    <Dialog open onOpenChange={(a) => !a && onFechar()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Receber parcela</DialogTitle>
          <DialogDescription>
            {descricaoDoRecebimento(conta)}. O valor entra
            no caixa de hoje.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            confirmar();
          }}
        >
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
              {pendente ? "Recebendo…" : "Confirmar recebimento"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Botão "Receber" que abre o diálogo. */
export function BotaoReceber({ conta, disabled }: { conta: ParcelaParaReceber; disabled?: boolean }) {
  const [aberto, setAberto] = useState(false);
  return (
    <>
      <Button type="button" size="sm" onClick={() => setAberto(true)} disabled={disabled}>
        Receber
      </Button>
      {aberto && <DialogoReceber conta={conta} onFechar={() => setAberto(false)} />}
    </>
  );
}
