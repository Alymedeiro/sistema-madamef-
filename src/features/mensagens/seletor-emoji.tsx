"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { CATEGORIAS_EMOJI } from "./emojis";

type Props = {
  onEscolher: (emoji: string) => void;
  onFechar: () => void;
};

/** Painel de emojis com abas por categoria. Fica aberto para inserir vários. */
export function SeletorEmoji({ onEscolher, onFechar }: Props) {
  const [categoria, setCategoria] = useState(CATEGORIAS_EMOJI[0].id);
  const atual =
    CATEGORIAS_EMOJI.find((c) => c.id === categoria) ?? CATEGORIAS_EMOJI[0];

  return (
    <div
      role="dialog"
      aria-label="Escolher emoji"
      data-testid="seletor-emoji"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onFechar();
        }
      }}
      className="absolute bottom-full left-0 z-10 mb-2 w-full max-w-sm rounded-xl border bg-card p-2 shadow-lg"
    >
      <div
        role="tablist"
        aria-label="Categorias de emoji"
        className="flex gap-1 overflow-x-auto pb-2"
      >
        {CATEGORIAS_EMOJI.map((c) => (
          <button
            key={c.id}
            type="button"
            role="tab"
            aria-selected={c.id === categoria}
            onClick={() => setCategoria(c.id)}
            className={cn(
              "min-h-11 shrink-0 rounded-md px-3 text-sm font-medium whitespace-nowrap text-muted-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring",
              c.id === categoria && "bg-muted text-foreground",
            )}
          >
            {c.rotulo}
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        className="grid max-h-48 grid-cols-6 gap-1 overflow-y-auto sm:grid-cols-8"
      >
        {atual.emojis.map((emoji) => (
          <button
            key={emoji}
            type="button"
            aria-label={`Inserir ${emoji}`}
            // Não tirar o foco/cursor da textarea ao clicar.
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onEscolher(emoji)}
            className="inline-flex size-11 items-center justify-center rounded-md text-2xl outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring"
          >
            {emoji}
          </button>
        ))}
      </div>
    </div>
  );
}
