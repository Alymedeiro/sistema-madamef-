"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { definirSenha, type EstadoSenha } from "./actions";

const INICIAL: EstadoSenha = {};

export function FormularioSenha() {
  const [estado, acao, pendente] = useActionState(definirSenha, INICIAL);
  const descr = estado.erro ? "erro-senha" : undefined;

  return (
    <form action={acao} className="flex flex-col gap-4" noValidate>
      <div className="flex flex-col gap-2">
        <Label htmlFor="senha">Nova senha</Label>
        <Input
          id="senha"
          name="senha"
          type="password"
          autoComplete="new-password"
          minLength={8}
          required
          aria-invalid={estado.erro ? true : undefined}
          aria-describedby={descr}
        />
        <p className="text-sm text-muted-foreground">Pelo menos 8 caracteres.</p>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="confirmacao">Repita a senha</Label>
        <Input
          id="confirmacao"
          name="confirmacao"
          type="password"
          autoComplete="new-password"
          required
          aria-invalid={estado.erro ? true : undefined}
          aria-describedby={descr}
        />
      </div>
      {estado.erro ? (
        <p id="erro-senha" role="alert" className="text-sm font-medium text-destructive">
          {estado.erro}
        </p>
      ) : null}
      <Button type="submit" size="lg" disabled={pendente}>
        {pendente ? "Salvando..." : "Salvar senha e entrar"}
      </Button>
    </form>
  );
}
