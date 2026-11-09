"use client";

import { cn } from "@/lib/utils";
import { rotuloServico, type ServicoOnline } from "./tipos";

export const estiloOpcao = (marcada: boolean) =>
  cn(
    "flex min-h-11 w-full items-center justify-between gap-3 rounded-md border bg-card px-4 py-3 text-left text-base shadow-xs transition-colors",
    "outline-none focus-visible:ring-[3px] focus-visible:ring-ring hover:bg-accent",
    marcada && "border-primary bg-blush-forte font-semibold",
  );

export function PassoServico({
  servicos,
  selecionado,
  aoEscolher,
}: {
  servicos: ServicoOnline[];
  selecionado: string | null;
  aoEscolher: (id: string) => void;
}) {
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="mb-3 font-titulo text-lg font-semibold text-ouro-escuro">
        1. Escolha o serviço
      </legend>
      {servicos.map((s) => (
        <button
          key={s.id}
          type="button"
          aria-pressed={selecionado === s.id}
          className={estiloOpcao(selecionado === s.id)}
          onClick={() => aoEscolher(s.id)}
        >
          <span>{rotuloServico(s)}</span>
          <span className="shrink-0 text-sm text-muted-foreground">{s.duracaoMin} min</span>
        </button>
      ))}
    </fieldset>
  );
}
