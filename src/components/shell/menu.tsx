"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CalendarDays,
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
import type { ItemMenu } from "@/lib/dominio/permissoes";

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

function useAtivo(href: string) {
  const pathname = usePathname();
  return pathname === href || pathname.startsWith(`${href}/`);
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

function LinkInferior({ item }: { item: ItemMenu }) {
  const ativo = useAtivo(item.href);
  const ref = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    // Com muitos itens a barra rola; deixa o item atual à vista.
    if (ativo) ref.current?.scrollIntoView({ inline: "center", block: "nearest" });
  }, [ativo]);

  return (
    <Link
      ref={ref}
      href={item.href}
      aria-current={ativo ? "page" : undefined}
      className={cn(
        "flex min-h-14 min-w-[4.25rem] shrink-0 snap-center flex-col items-center justify-center gap-0.5 rounded-md px-2 text-[0.6875rem] whitespace-nowrap font-medium outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring",
        ativo ? "bg-secondary text-ouro-escuro" : "text-foreground",
      )}
    >
      <Icone nome={item.icone} className="size-5" />
      <span>{item.rotulo}</span>
    </Link>
  );
}

/** Barra inferior (telas < 1024 px); rola na horizontal quando há muitos itens. */
export function MenuInferior({ itens }: { itens: ItemMenu[] }) {
  return (
    <nav
      aria-label="Menu principal"
      className="fixed inset-x-0 bottom-0 z-30 flex snap-x overflow-x-auto border-t bg-card px-1 pb-[env(safe-area-inset-bottom)] lg:hidden"
    >
      {itens.map((item) => (
        <LinkInferior key={item.recurso} item={item} />
      ))}
    </nav>
  );
}
