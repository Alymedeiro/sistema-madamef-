"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trocarSenha, type EstadoTroca } from "./actions";

const INICIAL: EstadoTroca = {};

export function FormularioTroca() {
  const [estado, acao, pendente] = useActionState(trocarSenha, INICIAL);
  const descr = estado.erro ? "erro-troca" : undefined;
  const invalido = estado.erro ? true : undefined;

  return (
    <form action={acao} className="flex flex-col gap-4" noValidate>
      <div className="flex flex-col gap-2">
        <Label htmlFor="email">E-mail</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          inputMode="email"
          required
          aria-invalid={invalido}
          aria-describedby={descr}
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="atual">Senha atual</Label>
        <Input
          id="atual"
          name="atual"
          type="password"
          autoComplete="current-password"
          required
          aria-invalid={invalido}
          aria-describedby={descr}
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="senha">Nova senha</Label>
        <Input
          id="senha"
          name="senha"
          type="password"
          autoComplete="new-password"
          minLength={8}
          required
          aria-invalid={invalido}
          aria-describedby={descr}
        />
        <p className="text-sm text-muted-foreground">Pelo menos 8 caracteres.</p>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="confirmacao">Repita a nova senha</Label>
        <Input
          id="confirmacao"
          name="confirmacao"
          type="password"
          autoComplete="new-password"
          required
          aria-invalid={invalido}
          aria-describedby={descr}
        />
      </div>
      {estado.erro ? (
        <p id="erro-troca" role="alert" className="text-sm font-medium text-destructive">
          {estado.erro}
        </p>
      ) : null}
      <Button type="submit" size="lg" disabled={pendente}>
        {pendente ? "Salvando..." : "Trocar senha e entrar"}
      </Button>
    </form>
  );
}
