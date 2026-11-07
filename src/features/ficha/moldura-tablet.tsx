"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export function MolduraTablet({
  titulo,
  voltarPara,
  children,
}: {
  titulo: string;
  voltarPara: string;
  children: React.ReactNode;
}) {
  const router = useRouter();

  useEffect(() => {
    // Tela cheia é conveniência: se o navegador recusar, segue sem ela.
    document.documentElement.requestFullscreen?.().catch(() => {});
    return () => {
      // Cancelar ou concluir sai da tela cheia.
      if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    };
  }, []);

  function cancelar() {
    if (
      window.confirm(
        "Cancelar o preenchimento? O que foi respondido será perdido.",
      )
    ) {
      router.push(voltarPara);
    }
  }

  return (
    <div className="flex min-h-dvh flex-col text-[20px] leading-relaxed">
      <header className="flex items-center gap-4 px-6 py-4">
        <h1 className="font-titulo text-3xl font-semibold tracking-wide text-ouro-escuro">
          {titulo}
        </h1>
        <Button
          type="button"
          variant="ghost"
          className="ml-auto min-h-11 text-muted-foreground"
          onClick={cancelar}
        >
          Cancelar
        </Button>
      </header>
      <main className="mx-auto w-full max-w-3xl flex-1 px-6 pb-10">
        {children}
      </main>
    </div>
  );
}
