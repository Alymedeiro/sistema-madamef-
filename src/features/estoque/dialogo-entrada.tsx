"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { PackagePlus } from "lucide-react";
import { toast } from "sonner";
import { registrarEntrada } from "@/app/(app)/produtos/actions-estoque";
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
import { Input } from "@/components/ui/input";
import { Campo, MensagemErro } from "@/features/financeiro/formulario";
import { formatarQuantidade, parseQuantidade } from "@/lib/dominio/catalogo";
import { formatarBRL, parseBRL } from "@/lib/dominio/dinheiro";

export type ProdutoDoDialogo = {
  id: string;
  nome: string;
  unidade: string;
  estoqueAtual: number;
  custoCentavos: number;
};

/** "R$ 12,50" → "12,50" (para preencher o campo). */
const valorParaCampo = (centavos: number) => formatarBRL(centavos).replace(/^R\$\s*/, "");

/** Entrada (compra): quantidade, custo unitário e, se quiser, a conta a pagar. */
export function DialogoEntrada({
  produto,
  hoje,
  onFechar,
}: {
  produto: ProdutoDoDialogo;
  hoje: string;
  onFechar: () => void;
}) {
  const id = useId();
  const router = useRouter();
  const [quantidade, setQuantidade] = useState("");
  const [custo, setCusto] = useState(valorParaCampo(produto.custoCentavos));
  const [lancarDespesa, setLancarDespesa] = useState(false);
  const [vencimento, setVencimento] = useState(hoje);
  const [fornecedor, setFornecedor] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();

  const q = parseQuantidade(quantidade);
  const c = parseBRL(custo);
  const total = q !== null && c !== null ? Math.round(q * c) : null;

  function confirmar() {
    setErro(null);
    iniciar(async () => {
      const r = await registrarEntrada({
        produtoId: produto.id,
        quantidade,
        custo,
        lancarDespesa,
        vencimento: lancarDespesa ? vencimento : undefined,
        fornecedor: lancarDespesa ? fornecedor : undefined,
      });
      if (!r.ok) {
        setErro(r.erro);
        return;
      }
      toast.success("Entrada registrada.");
      onFechar();
      router.refresh();
    });
  }

  return (
    <Dialog open onOpenChange={(a) => !a && onFechar()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Entrada</DialogTitle>
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
          <div className="grid gap-4 sm:grid-cols-2">
            <Campo id={`${id}-qtd`} rotulo={`Quantidade (${produto.unidade})`}>
              <Input
                id={`${id}-qtd`}
                inputMode="decimal"
                autoComplete="off"
                required
                value={quantidade}
                onChange={(e) => setQuantidade(e.target.value)}
                placeholder="Ex.: 1,5"
              />
            </Campo>
            <Campo id={`${id}-custo`} rotulo={`Custo por ${produto.unidade} (R$)`}>
              <Input
                id={`${id}-custo`}
                inputMode="decimal"
                autoComplete="off"
                required
                value={custo}
                onChange={(e) => setCusto(e.target.value)}
                placeholder="Ex.: 12,50"
              />
            </Campo>
          </div>
          <p className="rounded-md bg-muted p-3 text-sm">
            Total da compra:{" "}
            <span className="font-semibold tabular-nums" data-testid="total-entrada">
              {total === null ? "—" : formatarBRL(total)}
            </span>
            <span className="mt-1 block text-xs text-muted-foreground">
              O custo informado passa a ser o custo do produto.
            </span>
          </p>
          <label
            htmlFor={`${id}-despesa`}
            className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border bg-card px-3 py-2"
          >
            <Checkbox
              id={`${id}-despesa`}
              checked={lancarDespesa}
              onCheckedChange={(v) => setLancarDespesa(v === true)}
            />
            <span className="text-sm">Lançar a compra em Contas a pagar</span>
          </label>
          {lancarDespesa && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Campo id={`${id}-venc`} rotulo="Vencimento">
                <Input
                  id={`${id}-venc`}
                  type="date"
                  required
                  value={vencimento}
                  onChange={(e) => setVencimento(e.target.value)}
                />
              </Campo>
              <Campo id={`${id}-forn`} rotulo="Fornecedor (opcional)">
                <Input
                  id={`${id}-forn`}
                  autoComplete="off"
                  maxLength={120}
                  value={fornecedor}
                  onChange={(e) => setFornecedor(e.target.value)}
                />
              </Campo>
            </div>
          )}
          <MensagemErro erro={erro} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onFechar} disabled={pendente}>
              Voltar
            </Button>
            <Button type="submit" disabled={pendente}>
              {pendente ? "Salvando…" : "Registrar entrada"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Botão "Entrada" da linha (o diálogo só é montado quando aberto). */
export function BotaoEntrada({ produto, hoje }: { produto: ProdutoDoDialogo; hoje: string }) {
  const [aberto, setAberto] = useState(false);
  return (
    <>
      <Button type="button" size="sm" onClick={() => setAberto(true)}>
        <PackagePlus aria-hidden />
        Entrada<span className="sr-only"> de {produto.nome}</span>
      </Button>
      {aberto && <DialogoEntrada produto={produto} hoje={hoje} onFechar={() => setAberto(false)} />}
    </>
  );
}
