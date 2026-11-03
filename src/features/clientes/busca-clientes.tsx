"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const ATRASO_MS = 300;

type Props = {
  termoInicial: string;
  /** Mantém o filtro "mostrar inativas" ao buscar. */
  incluirInativas: boolean;
};

/** Campo único de busca (nome, WhatsApp ou CPF). Atualiza a URL 300 ms após parar de digitar. */
export function BuscaClientes({ termoInicial, incluirInativas }: Props) {
  const router = useRouter();
  const [termo, setTermo] = useState(termoInicial);
  const [pendente, iniciar] = useTransition();
  const aplicado = useRef(termoInicial);

  useEffect(() => {
    if (termo === aplicado.current) return;
    const timer = setTimeout(() => {
      aplicado.current = termo;
      const params = new URLSearchParams();
      if (termo.trim()) params.set("q", termo.trim());
      if (incluirInativas) params.set("inativas", "1");
      const query = params.toString();
      iniciar(() => router.replace(query ? `/clientes?${query}` : "/clientes"));
    }, ATRASO_MS);
    return () => clearTimeout(timer);
  }, [termo, incluirInativas, router]);

  return (
    <div role="search" className="flex max-w-xl flex-col gap-2">
      <Label htmlFor="busca-clientes">Buscar cliente</Label>
      <div className="relative">
        <Search
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          id="busca-clientes"
          type="search"
          inputMode="search"
          value={termo}
          onChange={(e) => setTermo(e.target.value)}
          placeholder="Nome, WhatsApp ou CPF"
          autoComplete="off"
          className="pl-9"
          aria-busy={pendente}
        />
      </div>
    </div>
  );
}
