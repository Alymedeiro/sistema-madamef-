"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { entrar, type EstadoLogin } from "./actions";

const ESTADO_INICIAL: EstadoLogin = {};

export function FormularioLogin() {
  const [estado, acao, pendente] = useActionState(entrar, ESTADO_INICIAL);

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
          aria-describedby={estado.erro ? "erro-login" : undefined}
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="senha">Senha</Label>
        <Input
          id="senha"
          name="senha"
          type="password"
          autoComplete="current-password"
          required
          aria-invalid={estado.erro ? true : undefined}
          aria-describedby={estado.erro ? "erro-login" : undefined}
        />
      </div>
      {estado.erro ? (
        <p id="erro-login" role="alert" className="text-sm font-medium text-destructive">
          {estado.erro}
        </p>
      ) : null}
      <Button type="submit" size="lg" disabled={pendente}>
        {pendente ? "Entrando..." : "Entrar"}
      </Button>
      <Link
        href="/esqueci-senha"
        className="inline-flex min-h-11 items-center justify-center text-sm font-medium text-ouro-escuro underline-offset-4 hover:underline"
      >
        Esqueci minha senha
      </Link>
    </form>
  );
}
