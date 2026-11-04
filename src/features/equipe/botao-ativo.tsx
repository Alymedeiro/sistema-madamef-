"use client";

import { useState, useTransition } from "react";
import { UserCheck, UserX } from "lucide-react";
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
import { definirAtivo } from "@/app/(app)/equipe/actions";

type Props = {
  id: string;
  nome: string;
  ativo: boolean;
  /** A dona não pode desativar a si mesma. */
  ehVoceMesma: boolean;
};

export function BotaoAtivo({ id, nome, ativo, ehVoceMesma }: Props) {
  const [aberto, setAberto] = useState(false);
  const [pendente, iniciar] = useTransition();

  if (ehVoceMesma) return null;

  function confirmar() {
    iniciar(async () => {
      const r = await definirAtivo(id, !ativo);
      if (r.ok) {
        toast.success(ativo ? `${nome} foi desativada.` : `${nome} foi reativada.`);
        setAberto(false);
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
        {ativo ? <UserX aria-hidden /> : <UserCheck aria-hidden />}
        {ativo ? "Desativar" : "Reativar"}
        <span className="sr-only"> {nome}</span>
      </Button>
      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{ativo ? `Desativar ${nome}?` : `Reativar ${nome}?`}</DialogTitle>
            <DialogDescription>
              {ativo
                ? "Ela perde o acesso ao sistema na hora e não consegue entrar de novo. O histórico (agendamentos, atendimentos) é mantido."
                : "Ela volta a ter acesso ao sistema com o perfil que já tinha."}
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
