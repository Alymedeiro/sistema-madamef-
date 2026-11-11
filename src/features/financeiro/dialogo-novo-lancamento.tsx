"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * "Novo lançamento": conta a pagar (abre o diálogo de nova conta) ou a receber
 * (vai para a aba Contas a receber com `novo=1`, que abre o diálogo de lá).
 * Montar só quando aberto.
 */
export function DialogoNovoLancamento({
  hrefNovaReceber,
  onPagar,
  onFechar,
}: {
  hrefNovaReceber: string;
  onPagar: () => void;
  onFechar: () => void;
}) {
  const router = useRouter();
  return (
    <Dialog open onOpenChange={(a) => !a && onFechar()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Novo lançamento</DialogTitle>
          <DialogDescription>O que você quer lançar?</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <Button type="button" size="lg" variant="outline" onClick={onPagar}>
            Conta a pagar
          </Button>
          <Button
            type="button"
            size="lg"
            variant="outline"
            onClick={() => {
              onFechar();
              router.push(hrefNovaReceber);
            }}
          >
            Conta a receber
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
