"use client";

import { useId, useState, useTransition } from "react";
import { Pencil, Plus } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { salvarCategoria } from "@/app/(app)/servicos/actions";
import { categoriaSchema } from "@/app/(app)/servicos/schemas";

type Props = { categoria?: { id: string; nome: string } };

/** Nova categoria (sem `categoria`) ou renomear uma existente. */
export function DialogoCategoria({ categoria }: Props) {
  const idCampo = useId();
  const [aberto, setAberto] = useState(false);
  const [nome, setNome] = useState(categoria?.nome ?? "");
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();

  function abrirFechar(valor: boolean) {
    setAberto(valor);
    if (valor) {
      setNome(categoria?.nome ?? "");
      setErro(null);
    }
  }

  function enviar(e: React.FormEvent) {
    e.preventDefault();
    const check = categoriaSchema.safeParse({ nome });
    if (!check.success) {
      setErro(check.error.issues[0].message);
      return;
    }
    setErro(null);
    iniciar(async () => {
      const r = await salvarCategoria({ nome }, categoria?.id);
      if (r.ok) {
        toast.success(categoria ? "Categoria renomeada." : "Categoria criada.");
        setAberto(false);
      } else {
        setErro(r.erro);
      }
    });
  }

  return (
    <>
      {categoria ? (
        <Button type="button" variant="ghost" size="sm" onClick={() => abrirFechar(true)}>
          <Pencil aria-hidden />
          Renomear<span className="sr-only"> categoria {categoria.nome}</span>
        </Button>
      ) : (
        <Button type="button" variant="outline" onClick={() => abrirFechar(true)}>
          <Plus aria-hidden />
          Nova categoria
        </Button>
      )}
      <Dialog open={aberto} onOpenChange={abrirFechar}>
        <DialogContent>
          <form onSubmit={enviar} noValidate className="grid gap-4">
            <DialogHeader>
              <DialogTitle>{categoria ? "Renomear categoria" : "Nova categoria"}</DialogTitle>
              <DialogDescription>
                As categorias agrupam os serviços na lista, por exemplo Facial ou Corporal.
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-2">
              <Label htmlFor={idCampo}>Nome da categoria</Label>
              <Input
                id={idCampo}
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                autoComplete="off"
                required
                aria-invalid={erro ? true : undefined}
                aria-describedby={erro ? `${idCampo}-erro` : undefined}
              />
              {erro ? (
                <p id={`${idCampo}-erro`} role="alert" className="text-sm font-medium text-destructive">
                  {erro}
                </p>
              ) : null}
            </div>
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="outline" disabled={pendente}>
                  Cancelar
                </Button>
              </DialogClose>
              <Button type="submit" disabled={pendente}>
                {pendente ? "Salvando..." : "Salvar"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
