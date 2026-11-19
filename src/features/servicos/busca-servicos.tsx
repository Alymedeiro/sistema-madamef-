"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const ATRASO_MS = 300;

/** Busca por nome ou categoria. Atualiza a URL (?q=) 300 ms após parar de digitar. */
export function BuscaServicos({ termoInicial }: { termoInicial: string }) {
  const router = useRouter();
  const [termo, setTermo] = useState(termoInicial);
  const [pendente, iniciar] = useTransition();
  const aplicado = useRef(termoInicial);

  useEffect(() => {
    if (termo === aplicado.current) return;
    const timer = setTimeout(() => {
      aplicado.current = termo;
      const q = termo.trim();
      iniciar(() =>
        router.replace(q ? `/servicos?q=${encodeURIComponent(q)}` : "/servicos", { scroll: false }),
      );
    }, ATRASO_MS);
    return () => clearTimeout(timer);
  }, [termo, router]);

  return (
    <div role="search" className="flex max-w-xl flex-col gap-2">
      <Label htmlFor="busca-servicos">Buscar serviço</Label>
      <div className="relative">
        <Search
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          id="busca-servicos"
          type="search"
          inputMode="search"
          value={termo}
          onChange={(e) => setTermo(e.target.value)}
          placeholder="Nome ou categoria (ex.: laser, sobrancelha)"
          autoComplete="off"
          className="pl-9"
          aria-busy={pendente}
        />
      </div>
    </div>
  );
}
