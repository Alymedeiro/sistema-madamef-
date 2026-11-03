"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Power, PowerOff } from "lucide-react";
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
import { definirClienteAtivo } from "@/app/(app)/clientes/actions";

type Props = { id: string; nome: string; ativo: boolean };

/** Desativar/reativar cliente (exclusão lógica), com confirmação. Dona e recepção. */
export function BotaoAtivoCliente({ id, nome, ativo }: Props) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [pendente, iniciar] = useTransition();

  function confirmar() {
    iniciar(async () => {
      const r = await definirClienteAtivo(id, !ativo);
      if (r.ok) {
        toast.success(ativo ? `${nome} foi desativada.` : `${nome} foi reativada.`);
        setAberto(false);
        router.refresh();
      } else {
        toast.error(r.erro);
      }
    });
  }

  return (
    <>
      <Button
        type="button"
        variant={ativo ? "outline" : "default"}
        size="sm"
        onClick={() => setAberto(true)}
      >
        {ativo ? <PowerOff aria-hidden /> : <Power aria-hidden />}
        {ativo ? "Desativar" : "Reativar"}
      </Button>
      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{ativo ? `Desativar ${nome}?` : `Reativar ${nome}?`}</DialogTitle>
            <DialogDescription>
              {ativo
                ? "Ela deixa de aparecer nas buscas e em novos agendamentos. O histórico é mantido."
                : "Ela volta a aparecer nas buscas e em novos agendamentos."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline" disabled={pendente}>
                Cancelar
              </Button>
            </DialogClose>
            <Button
              type="button"
              variant={ativo ? "destructive" : "default"}
              onClick={confirmar}
              disabled={pendente}
            >
              {pendente ? "Salvando..." : ativo ? "Desativar" : "Reativar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
