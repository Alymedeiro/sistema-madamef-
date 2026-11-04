"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MENSAGEM_NEUTRA } from "./schemas";
import { solicitarRecuperacao, type EstadoRecuperacao } from "./actions";

const INICIAL: EstadoRecuperacao = {};

export function FormularioRecuperacao() {
  const [estado, acao, pendente] = useActionState(solicitarRecuperacao, INICIAL);

  if (estado.enviado) {
    return (
      <p role="status" className="text-sm">
        {MENSAGEM_NEUTRA}
      </p>
    );
  }

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
          aria-invalid={estado.erro ? true : undefined}
          aria-describedby={estado.erro ? "erro-email" : undefined}
        />
      </div>
      {estado.erro ? (
        <p id="erro-email" role="alert" className="text-sm font-medium text-destructive">
          {estado.erro}
        </p>
      ) : null}
      <Button type="submit" size="lg" disabled={pendente}>
        {pendente ? "Enviando..." : "Enviar link"}
      </Button>
    </form>
  );
}
