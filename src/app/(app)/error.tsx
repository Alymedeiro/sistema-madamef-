"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

/** Falha ao carregar uma tela do sistema: mensagem em português e nova tentativa. */
export default function ErroDaTela({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <section
      role="alert"
      className="mx-auto flex max-w-md flex-col items-center gap-4 rounded-xl border bg-card p-6 text-center"
    >
      <h1 className="font-titulo text-xl font-semibold text-ouro-escuro">Algo deu errado</h1>
      <p className="text-sm">
        Não foi possível carregar esta tela. Verifique a conexão com a internet e tente novamente.
      </p>
      <Button type="button" onClick={reset}>
        Tentar novamente
      </Button>
    </section>
  );
}
