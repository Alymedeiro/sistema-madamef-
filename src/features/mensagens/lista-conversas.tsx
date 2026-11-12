"use client";

import { useEffect, useRef, useState } from "react";
import { Archive, ArchiveRestore, MoreHorizontal } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
  arquivadas = false,
  onArquivar,
  onDesarquivar,
}: {
  conversas: ResumoConversa[];
  selecionada: string | null;
  onSelecionar: (c: ResumoConversa) => void;
  /** Filtro "Arquivadas": a ação é Desarquivar. */
  arquivadas?: boolean;
  onArquivar: (chaves: string[]) => void;
  onDesarquivar: (chaves: string[]) => void;
}) {
  const [selecionando, setSelecionando] = useState(false);
  const [marcadas, setMarcadas] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState<{ chave: string; acima: boolean } | null>(
    null,
  );
  const botaoMenuRef = useRef<HTMLButtonElement | null>(null);

  function fecharMenu(focar: boolean) {
    setMenu(null);
    if (focar) botaoMenuRef.current?.focus();
  }

  // Menu "⋯": fecha ao clicar fora ou com Esc.
  useEffect(() => {
    if (!menu) return;
    const fora = (e: PointerEvent) => {
      if (
        !(e.target instanceof Element) ||
        !e.target.closest("[data-menu-conversa]")
      )
        setMenu(null);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") fecharMenu(true);
    };
    document.addEventListener("pointerdown", fora);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", fora);
      document.removeEventListener("keydown", esc);
    };
  }, [menu]);

  const visiveis = new Set(conversas.map((c) => c.chave));
  // Só conta o que ainda está na lista (o recarregamento pode tirar conversas).
  const escolhidas = [...marcadas].filter((k) => visiveis.has(k));
  const todasMarcadas =
    conversas.length > 0 && escolhidas.length === conversas.length;
  const verbo = arquivadas ? "Desarquivar" : "Arquivar";
  const acao = arquivadas ? onDesarquivar : onArquivar;

  function sair() {
    setSelecionando(false);
    setMarcadas(new Set());
  }

  function alternar(chave: string) {
    setMarcadas((m) => {
      const n = new Set(m);
      if (n.has(chave)) n.delete(chave);
      else n.add(chave);
      return n;
    });
  }

  const barra = selecionando ? (
    <div className="flex flex-wrap items-center gap-2">
      <label className="flex min-h-11 cursor-pointer items-center gap-2 pr-2 text-sm">
        <Checkbox
          checked={todasMarcadas}
          onCheckedChange={(v) =>
            setMarcadas(
              v === true ? new Set(conversas.map((c) => c.chave)) : new Set(),
            )
          }
        />
        Selecionar todas (visíveis)
      </label>
      <Button
        type="button"
        size="sm"
        disabled={escolhidas.length === 0}
        onClick={() => {
          acao(escolhidas);
          sair();
        }}
      >
        {verbo} ({escolhidas.length})
      </Button>
      <Button type="button" size="sm" variant="outline" onClick={sair}>
        Cancelar
      </Button>
    </div>
  ) : (
    conversas.length > 0 && (
      <div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => setSelecionando(true)}
        >
          Selecionar
        </Button>
      </div>
    )
  );

  if (conversas.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        {arquivadas
          ? "Nenhuma conversa arquivada."
          : "Nenhuma conversa encontrada."}
      </p>
    );
  }
  const agora = new Date();
  return (
    <div className="flex flex-col gap-3">
      {barra}
      <ul className="flex flex-col divide-y rounded-xl border bg-card shadow-sm">
        {conversas.map((c) => (
          <li
            key={c.chave}
            className="relative flex items-stretch first:rounded-t-xl last:rounded-b-xl"
          >
            {selecionando && (
              <label className="flex min-h-11 min-w-11 shrink-0 cursor-pointer items-center justify-center pl-2">
                <Checkbox
                  checked={marcadas.has(c.chave)}
                  onCheckedChange={() => alternar(c.chave)}
                  aria-label={`Selecionar ${c.nome ?? formatarTelefone(c.telefone)}`}
                />
              </label>
            )}
            <button
              type="button"
              onClick={() =>
                selecionando ? alternar(c.chave) : onSelecionar(c)
              }
              aria-current={c.chave === selecionada ? "true" : undefined}
              className={cn(
                "flex min-h-16 min-w-0 flex-1 flex-col gap-1 rounded-[inherit] px-4 py-3 text-left text-sm hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none",
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
                  <span className="tabular-nums">
                    {formatarTelefone(c.telefone)}
                  </span>
                ) : (
                  <Badge variant="outline">sem cadastro</Badge>
                )}
                {c.leadId && !c.clienteId && (
                  <Badge variant="outline">lead</Badge>
                )}
                {c.falhou && (
                  <Badge
                    variant="outline"
                    className="border-destructive/40 bg-destructive/10 text-destructive"
                  >
                    ⚠ Falhou
                  </Badge>
                )}
                {c.classificacao && (
                  <Badge
                    variant="outline"
                    className={cn(COR_CLASSIFICACAO[c.classificacao])}
                  >
                    {ROTULO_CLASSIFICACAO[c.classificacao]}
                  </Badge>
                )}
              </span>
            </button>
            {!selecionando && (
              <div
                data-menu-conversa
                className="relative flex shrink-0 items-start pt-2 pr-1"
              >
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="Mais ações"
                  aria-haspopup="menu"
                  aria-expanded={menu?.chave === c.chave}
                  onClick={(e) => {
                    if (menu?.chave === c.chave) return fecharMenu(true);
                    botaoMenuRef.current = e.currentTarget;
                    // Linha na metade de baixo da tela: o menu abre para cima.
                    const { top } = e.currentTarget.getBoundingClientRect();
                    setMenu({
                      chave: c.chave,
                      acima: top > window.innerHeight / 2,
                    });
                  }}
                >
                  <MoreHorizontal aria-hidden />
                </Button>
                {menu?.chave === c.chave && (
                  <div
                    role="menu"
                    className={cn(
                      "absolute right-1 z-20 min-w-48 rounded-md border bg-card p-1 shadow-md",
                      menu.acima ? "bottom-12" : "top-12",
                    )}
                  >
                    <button
                      type="button"
                      role="menuitem"
                      autoFocus
                      className="flex min-h-11 w-full items-center gap-2 rounded-sm px-3 text-left text-sm hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
                      onClick={() => {
                        fecharMenu(true);
                        acao([c.chave]);
                      }}
                    >
                      {arquivadas ? (
                        <ArchiveRestore className="size-4" aria-hidden />
                      ) : (
                        <Archive className="size-4" aria-hidden />
                      )}
                      {arquivadas
                        ? "Desarquivar conversa"
                        : "Arquivar conversa"}
                    </button>
                  </div>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
