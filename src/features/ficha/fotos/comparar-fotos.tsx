"use client";

import { ROTULO_TIPO_FOTO } from "@/lib/dominio/fotos";
import { formatarNoFuso } from "@/lib/dominio/tempo";
import type { FotoFicha } from "@/app/(app)/clientes/ficha/dados";

/** Duas fotos lado a lado a partir de 640 px; uma sobre a outra abaixo disso. */
export function CompararFotos({
  fotos,
  urls,
  aoFalharImagem,
}: {
  fotos: [FotoFicha, FotoFicha];
  urls: Record<string, string>;
  aoFalharImagem: () => void;
}) {
  return (
    <div className="grid gap-3 min-[640px]:grid-cols-2">
      {fotos.map((f) => (
        <figure key={f.id} className="flex flex-col gap-1">
          {/* eslint-disable-next-line @next/next/no-img-element -- URL assinada temporária (5 min) */}
          <img
            src={urls[f.id] ?? f.url}
            alt={`${ROTULO_TIPO_FOTO[f.tipo]}, ${formatarNoFuso(f.tiradaEm, "dd/MM/yyyy")}`}
            className="max-h-[70dvh] w-full rounded-lg bg-muted object-contain"
            onError={aoFalharImagem}
          />
          <figcaption className="text-center text-sm font-medium">
            {ROTULO_TIPO_FOTO[f.tipo]} · {formatarNoFuso(f.tiradaEm, "dd/MM/yyyy")}
            {f.servicoNome ? ` · ${f.servicoNome}` : ""}
          </figcaption>
        </figure>
      ))}
    </div>
  );
}
