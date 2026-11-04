"use client";

import { useEffect } from "react";
import "./globals.css";

/**
 * Último recurso: erro no layout raiz. Substitui o layout inteiro, por isso
 * define <html> e <body> e não depende de outros componentes.
 */
export default function ErroGlobal({
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
    <html lang="pt-BR">
      <body>
        <main className="flex min-h-dvh items-center justify-center p-4">
          <section
            role="alert"
            className="flex max-w-md flex-col items-center gap-4 rounded-xl border bg-card p-6 text-center"
          >
            <h1 className="text-xl font-semibold text-ouro-escuro">Algo deu errado</h1>
            <p className="text-sm">
              O sistema encontrou um erro inesperado. Tente novamente; se continuar, recarregue a
              página.
            </p>
            <button
              type="button"
              onClick={reset}
              className="min-h-11 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring"
            >
              Tentar novamente
            </button>
          </section>
        </main>
      </body>
    </html>
  );
}
