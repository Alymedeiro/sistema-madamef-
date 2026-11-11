"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ClipboardCheck } from "lucide-react";
import { toast } from "sonner";
import { ajustarEstoque } from "@/app/(app)/produtos/actions-estoque";
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
import { Campo, MensagemErro } from "@/features/financeiro/formulario";
import { formatarQuantidade, parseQuantidade, quantidadeParaCampo } from "@/lib/dominio/catalogo";
import { diferencaAjuste } from "@/lib/dominio/estoque";
import type { ProdutoDoDialogo } from "./dialogo-entrada";
import { QuantidadeComSinal } from "./historico";

/** Ajuste (contagem): a quantidade contada substitui o saldo; a diferença vira movimento. */
export function DialogoAjuste({ produto, onFechar }: { produto: ProdutoDoDialogo; onFechar: () => void }) {
  const id = useId();
  const router = useRouter();
  const [contada, setContada] = useState(quantidadeParaCampo(produto.estoqueAtual));
  const [motivo, setMotivo] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();

  const n = parseQuantidade(contada);
  const diferenca = n === null ? null : diferencaAjuste(produto.estoqueAtual, n);

  function confirmar() {
    setErro(null);
    iniciar(async () => {
      const r = await ajustarEstoque({ produtoId: produto.id, contada, motivo });
      if (!r.ok) {
        setErro(r.erro);
        return;
      }
      toast.success("Estoque ajustado.");
      onFechar();
      router.refresh();
    });
  }

  return (
    <Dialog open onOpenChange={(a) => !a && onFechar()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Ajuste</DialogTitle>
          <DialogDescription>
            {produto.nome} — estoque atual {formatarQuantidade(produto.estoqueAtual)} {produto.unidade}
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            confirmar();
          }}
        >
          <Campo id={`${id}-contada`} rotulo={`Quantidade contada (${produto.unidade})`}>
            <Input
              id={`${id}-contada`}
              inputMode="decimal"
              autoComplete="off"
              required
              value={contada}
              onChange={(e) => setContada(e.target.value)}
            />
          </Campo>
          <p className="rounded-md bg-muted p-3 text-sm">
            Diferença:{" "}
            <span className="font-semibold" data-testid="diferenca-ajuste">
              {diferenca === null ? (
                "—"
              ) : diferenca === 0 ? (
                "nenhuma"
              ) : (
                <QuantidadeComSinal quantidade={diferenca} unidade={produto.unidade} />
              )}
            </span>
          </p>
          <Campo id={`${id}-motivo`} rotulo="Motivo">
            <Input
              id={`${id}-motivo`}
              autoComplete="off"
              required
              maxLength={200}
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Ex.: contagem do mês, quebra, validade"
            />
          </Campo>
          <MensagemErro erro={erro} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onFechar} disabled={pendente}>
              Voltar
            </Button>
            <Button type="submit" disabled={pendente}>
              {pendente ? "Salvando…" : "Salvar ajuste"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Botão "Ajuste" da linha (o diálogo só é montado quando aberto). */
export function BotaoAjuste({ produto }: { produto: ProdutoDoDialogo }) {
  const [aberto, setAberto] = useState(false);
  return (
    <>
      <Button type="button" size="sm" variant="outline" onClick={() => setAberto(true)}>
        <ClipboardCheck aria-hidden />
        Ajuste<span className="sr-only"> de {produto.nome}</span>
      </Button>
      {aberto && <DialogoAjuste produto={produto} onFechar={() => setAberto(false)} />}
    </>
  );
}
