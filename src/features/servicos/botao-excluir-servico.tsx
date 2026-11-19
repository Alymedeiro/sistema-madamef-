"use client";

import { useState, useTransition } from "react";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { excluirServico } from "@/app/(app)/servicos/actions";

/** Exclui de vez (só serviço sem histórico), com confirmação. Só a dona vê. */
export function BotaoExcluirServico({ id, nome }: { id: string; nome: string }) {
  const [aberto, setAberto] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();

  function confirmar() {
    iniciar(async () => {
      const r = await excluirServico(id);
      if (r.ok) {
        toast.success(`${nome} foi excluído.`);
        setAberto(false);
      } else {
        setErro(r.erro);
      }
    });
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => {
          setErro(null);
          setAberto(true);
        }}
        className="text-destructive hover:text-destructive"
      >
        <Trash2 aria-hidden />
        Excluir<span className="sr-only"> {nome}</span>
      </Button>
      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Excluir {nome}?</DialogTitle>
            <DialogDescription>
              O serviço some de vez do sistema e do agendamento online, junto com as fotos. Não dá
              para desfazer. Serviço que já tem agendamento, pacote ou pedido não pode ser excluído:
              nesse caso, use &quot;Desativar&quot;.
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
            <DialogClose asChild>
              <Button type="button" variant="outline" disabled={pendente}>
                Cancelar
              </Button>
            </DialogClose>
            <Button type="button" variant="destructive" onClick={confirmar} disabled={pendente || !!erro}>
              {pendente ? "Excluindo..." : "Excluir"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
