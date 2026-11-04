"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CalendarDays,
  Ellipsis,
  House,
  Package,
  Settings,
  Sparkles,
  UserCog,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { dividirMenuInferior, type ItemMenu } from "@/lib/dominio/permissoes";

// Os nomes de ícone vêm de ITENS_MENU como texto (serializável do servidor).
const ICONES: Record<string, LucideIcon> = {
  House,
  CalendarDays,
  Users,
  Sparkles,
  Package,
  Wallet,
  UserCog,
  Settings,
};

function Icone({ nome, className }: { nome: string; className?: string }) {
  const Componente = ICONES[nome] ?? House;
  return <Componente aria-hidden className={className} />;
}

function ativoEm(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function useAtivo(href: string) {
  return ativoEm(usePathname(), href);
}

function LinkLateral({ item }: { item: ItemMenu }) {
  const ativo = useAtivo(item.href);
  return (
    <Link
      href={item.href}
      aria-current={ativo ? "page" : undefined}
      className={cn(
        "flex min-h-11 items-center gap-3 rounded-md px-3 text-sm font-medium outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring",
        ativo
          ? "bg-secondary text-ouro-escuro"
          : "text-foreground hover:bg-accent",
      )}
    >
      <Icone nome={item.icone} className="size-5 shrink-0" />
      {item.rotulo}
    </Link>
  );
}

/** Menu lateral (telas >= 1024 px). */
export function MenuLateral({ itens }: { itens: ItemMenu[] }) {
  return (
    <nav aria-label="Menu principal" className="flex flex-col gap-1">
      {itens.map((item) => (
        <LinkLateral key={item.recurso} item={item} />
      ))}
    </nav>
  );
}

const CLASSE_ITEM_INFERIOR =
  "flex min-h-14 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-md px-1 text-[0.6875rem] whitespace-nowrap font-medium outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring";

function LinkInferior({ item }: { item: ItemMenu }) {
  const ativo = useAtivo(item.href);
  return (
    <Link
      href={item.href}
      aria-current={ativo ? "page" : undefined}
      className={cn(CLASSE_ITEM_INFERIOR, ativo ? "bg-secondary text-ouro-escuro" : "text-foreground")}
    >
      <Icone nome={item.icone} className="size-5" />
      <span>{item.rotulo}</span>
    </Link>
  );
}

/** Botão "Mais" da barra inferior: abre a lista dos itens que não couberam. */
function MenuMais({ itens }: { itens: ItemMenu[] }) {
  const pathname = usePathname();
  const id = useId();
  const [aberto, setAberto] = useState(false);
  const raiz = useRef<HTMLDivElement>(null);
  const ativo = itens.some((i) => ativoEm(pathname, i.href));

  // Fecha ao navegar.
  useEffect(() => setAberto(false), [pathname]);

  useEffect(() => {
    if (!aberto) return;
    const fora = (e: PointerEvent) => {
      if (!raiz.current?.contains(e.target as Node)) setAberto(false);
    };
    const tecla = (e: KeyboardEvent) => {
      if (e.key === "Escape") setAberto(false);
    };
    document.addEventListener("pointerdown", fora);
    document.addEventListener("keydown", tecla);
    return () => {
      document.removeEventListener("pointerdown", fora);
      document.removeEventListener("keydown", tecla);
    };
  }, [aberto]);

  return (
    <div ref={raiz} className="flex min-w-0 flex-1">
      <button
        type="button"
        aria-expanded={aberto}
        aria-controls={`${id}-lista`}
        onClick={() => setAberto((a) => !a)}
        className={cn(
          CLASSE_ITEM_INFERIOR,
          ativo || aberto ? "bg-secondary text-ouro-escuro" : "text-foreground",
        )}
      >
        <Ellipsis aria-hidden className="size-5" />
        <span>Mais</span>
      </button>
      {aberto && (
        <ul
          id={`${id}-lista`}
          aria-label="Mais opções"
          className="absolute right-1 bottom-full mb-2 flex w-56 flex-col gap-1 rounded-xl border bg-card p-2 shadow-lg"
        >
          {itens.map((item) => {
            const atual = ativoEm(pathname, item.href);
            return (
              <li key={item.recurso}>
                <Link
                  href={item.href}
                  aria-current={atual ? "page" : undefined}
                  onClick={() => setAberto(false)}
                  className={cn(
                    "flex min-h-11 items-center gap-3 rounded-md px-3 text-sm font-medium outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring",
                    atual ? "bg-secondary text-ouro-escuro" : "text-foreground hover:bg-accent",
                  )}
                >
                  <Icone nome={item.icone} className="size-5 shrink-0" />
                  {item.rotulo}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/**
 * Barra inferior (telas < 1024 px), sem rolagem horizontal: até 5 itens
 * aparecem todos; com mais, Início, Agenda, Clientes, Caixa e "Mais".
 */
export function MenuInferior({ itens }: { itens: ItemMenu[] }) {
  const { principais, mais } = dividirMenuInferior(itens);
  return (
    <nav
      aria-label="Menu principal"
      className="fixed inset-x-0 bottom-0 z-30 flex gap-1 border-t bg-card px-1 pb-[env(safe-area-inset-bottom)] lg:hidden"
    >
      {principais.map((item) => (
        <LinkInferior key={item.recurso} item={item} />
      ))}
      {mais.length > 0 && <MenuMais itens={mais} />}
    </nav>
  );
}
