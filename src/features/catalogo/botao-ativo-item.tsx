"use client";

import { useState, useTransition } from "react";
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
import { definirProdutoAtivo } from "@/app/(app)/produtos/actions";
import { definirServicoAtivo } from "@/app/(app)/servicos/actions";

type Props = {
  tipo: "servico" | "produto";
  id: string;
  nome: string;
  ativo: boolean;
};

const TEXTOS = {
  servico: {
    desativar:
      "Ele deixa de aparecer para novos agendamentos. O histórico de atendimentos é mantido.",
    reativar: "Ele volta a aparecer para novos agendamentos.",
  },
  produto: {
    desativar: "Ele deixa de aparecer nas listas de uso. O histórico é mantido.",
    reativar: "Ele volta a aparecer nas listas de uso.",
  },
} as const;

/** Desativar/reativar (exclusão lógica) com confirmação. Só a dona vê este botão. */
export function BotaoAtivoItem({ tipo, id, nome, ativo }: Props) {
  const [aberto, setAberto] = useState(false);
  const [pendente, iniciar] = useTransition();

  function confirmar() {
    iniciar(async () => {
      const r =
        tipo === "servico"
          ? await definirServicoAtivo(id, !ativo)
          : await definirProdutoAtivo(id, !ativo);
      if (r.ok) {
        toast.success(ativo ? `${nome} foi desativado.` : `${nome} foi reativado.`);
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
        {ativo ? <PowerOff aria-hidden /> : <Power aria-hidden />}
        {ativo ? "Desativar" : "Reativar"}
        <span className="sr-only"> {nome}</span>
      </Button>
      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{ativo ? `Desativar ${nome}?` : `Reativar ${nome}?`}</DialogTitle>
            <DialogDescription>
              {ativo ? TEXTOS[tipo].desativar : TEXTOS[tipo].reativar}
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
