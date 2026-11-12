"use client";

import { Badge } from "@/components/ui/badge";
import type { ResumoConversa } from "@/app/(app)/mensagens/dados";
import { formatarTelefone } from "@/lib/dominio/telefone";
import { ROTULO_CLASSIFICACAO } from "@/lib/dominio/whatsapp";
import { cn } from "@/lib/utils";
import { rotuloHorarioConversa } from "./conversa";
import { COR_CLASSIFICACAO } from "./lista-respostas";

export function ListaConversas({
  conversas,
  selecionada,
  onSelecionar,
}: {
  conversas: ResumoConversa[];
  selecionada: string | null;
  onSelecionar: (c: ResumoConversa) => void;
}) {
  if (conversas.length === 0) {
    return <p className="text-sm text-muted-foreground">Nenhuma resposta recebida.</p>;
  }
  const agora = new Date();
  return (
    <ul className="flex flex-col divide-y overflow-hidden rounded-xl border bg-card shadow-sm">
      {conversas.map((c) => (
        <li key={c.chave}>
          <button
            type="button"
            onClick={() => onSelecionar(c)}
            aria-current={c.chave === selecionada ? "true" : undefined}
            className={cn(
              "flex min-h-16 w-full flex-col gap-1 px-4 py-3 text-left text-sm hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none",
              c.chave === selecionada && "bg-muted",
            )}
          >
            <span className="flex items-center gap-2">
              <span
                className={cn(
                  "min-w-0 flex-1 truncate",
                  c.naoLidas > 0 ? "font-semibold" : "font-medium",
                )}
              >
                {c.nome ?? formatarTelefone(c.telefone)}
              </span>
              <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                {rotuloHorarioConversa(c.ultima.quando, agora)}
              </span>
            </span>
            <span className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-muted-foreground">
                {c.ultima.direcao === "enviada" ? "Você: " : ""}
                {c.ultima.texto.replace(/\s+/g, " ")}
              </span>
              {c.naoLidas > 0 && (
                <span
                  aria-label={`${c.naoLidas} ${c.naoLidas === 1 ? "não lida" : "não lidas"}`}
                  className="inline-flex min-w-5 shrink-0 items-center justify-center rounded-full bg-ouro-escuro px-1.5 text-xs font-medium text-white tabular-nums"
                >
                  {c.naoLidas}
                </span>
              )}
            </span>
            <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              {c.nome ? (
                <span className="tabular-nums">{formatarTelefone(c.telefone)}</span>
              ) : (
                <Badge variant="outline">sem cadastro</Badge>
              )}
              {c.classificacao && (
                <Badge variant="outline" className={cn(COR_CLASSIFICACAO[c.classificacao])}>
                  {ROTULO_CLASSIFICACAO[c.classificacao]}
                </Badge>
              )}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
