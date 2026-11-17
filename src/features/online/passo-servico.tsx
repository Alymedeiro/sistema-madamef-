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
  // Com alguma foto, cartões em grade; sem nenhuma, a lista simples de antes.
  const comFotos = servicos.some((s) => s.fotos.length > 0);
  return (
    <fieldset className="flex min-w-0 flex-col gap-3">
      <legend className="mb-3 font-titulo text-lg font-semibold text-ouro-escuro">
        1. Escolha o serviço
      </legend>
      <div className={cn("grid gap-3", comFotos && "sm:grid-cols-2")}>
        {servicos.map((s) => {
          const capa = s.fotos[0];
          return (
            <button
              key={s.id}
              type="button"
              aria-pressed={selecionado === s.id}
              onClick={() => aoEscolher(s.id)}
              className={cn(
                estiloOpcao(selecionado === s.id),
                capa && "flex-col items-stretch justify-start overflow-hidden p-0",
              )}
            >
              {capa ? (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element -- Storage sem next/image configurado */}
                  <img
                    src={capa.url}
                    alt={s.nome}
                    width={capa.largura ?? 400}
                    height={capa.altura ?? 300}
                    loading="lazy"
                    className="aspect-[4/3] w-full bg-muted object-cover"
                  />
                  <span className="flex items-center justify-between gap-3 px-4 py-3">
                    <span>{rotuloServico(s)}</span>
                    <span className="shrink-0 text-sm text-muted-foreground">{s.duracaoMin} min</span>
                  </span>
                </>
              ) : (
                <>
                  <span>{rotuloServico(s)}</span>
                  <span className="shrink-0 text-sm text-muted-foreground">{s.duracaoMin} min</span>
                </>
              )}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
