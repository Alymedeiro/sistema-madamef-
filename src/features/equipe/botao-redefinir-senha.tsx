"use client";

import { useState, useTransition } from "react";
import { KeyRound } from "lucide-react";
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
import { redefinirSenha } from "@/app/(app)/equipe/actions";

/** A dona define uma senha provisória; a pessoa troca no próximo acesso. */
export function BotaoRedefinirSenha({ id, nome }: { id: string; nome: string }) {
  const [aberto, setAberto] = useState(false);
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();

  function salvar(e: React.FormEvent) {
    e.preventDefault();
    if (senha.length < 8) {
      setErro("A senha provisória precisa ter pelo menos 8 caracteres.");
      return;
    }
    setErro(null);
    iniciar(async () => {
      const r = await redefinirSenha(id, senha);
      if (r.ok) {
        toast.success(`Senha de ${nome} redefinida. Passe a senha provisória para ela.`);
        setSenha("");
        setAberto(false);
      } else {
        setErro(r.erro);
      }
    });
  }

  return (
    <>
      <Button type="button" variant="outline" onClick={() => setAberto(true)}>
        <KeyRound aria-hidden />
        Redefinir senha
      </Button>
      <Dialog
        open={aberto}
        onOpenChange={(v) => {
          setAberto(v);
          if (!v) {
            setSenha("");
            setErro(null);
          }
        }}
      >
        <DialogContent>
          <form onSubmit={salvar} noValidate className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle>Redefinir senha de {nome}</DialogTitle>
              <DialogDescription>
                Crie uma senha provisória e passe para ela. No próximo acesso, o sistema pede
                que ela crie a própria senha. A senha antiga deixa de funcionar.
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-2">
              <Label htmlFor="senha-provisoria">Senha provisória</Label>
              <Input
                id="senha-provisoria"
                type="text"
                autoComplete="off"
                spellCheck={false}
                value={senha}
                onChange={(e) => setSenha(e.target.value)}
                minLength={8}
                maxLength={72}
                aria-invalid={erro ? true : undefined}
                aria-describedby={erro ? "erro-redefinir" : undefined}
              />
              <p className="text-sm text-muted-foreground">Pelo menos 8 caracteres.</p>
            </div>
            {erro ? (
              <p id="erro-redefinir" role="alert" className="text-sm font-medium text-destructive">
                {erro}
              </p>
            ) : null}
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="outline" disabled={pendente}>
                  Cancelar
                </Button>
              </DialogClose>
              <Button type="submit" disabled={pendente}>
                {pendente ? "Salvando..." : "Redefinir senha"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
