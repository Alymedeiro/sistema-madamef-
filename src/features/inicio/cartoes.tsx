import type { ReactNode } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { COR_STATUS } from "@/lib/dominio/status";
import { formatarNoFuso } from "@/lib/dominio/tempo";
import { cn } from "@/lib/utils";
import { tempoRestante } from "@/features/pedidos/prazo";
import type { Aniversariante, ItemAgenda, ItemSemTermo, PedidoAguardando } from "./dados";
import type { ProdutoEstoque } from "./painel";

export function CartaoPainel({
  id,
  titulo,
  vazio,
  vazioTexto,
  falhou = false,
  children,
}: {
  id: string;
  titulo: string;
  vazio: boolean;
  vazioTexto: string;
  /** O carregamento deste cartão falhou (os demais seguem normais). */
  falhou?: boolean;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3 rounded-xl border bg-card p-4 shadow-sm">
      <h2 id={id} className="font-titulo text-lg font-semibold text-ouro-escuro">
        {titulo}
      </h2>
      {falhou ? (
        <p role="alert" className="text-sm text-destructive">
          Não foi possível carregar este quadro. Atualize a página para tentar de novo.
        </p>
      ) : vazio ? (
        <p className="text-sm text-muted-foreground">{vazioTexto}</p>
      ) : (
        children
      )}
    </section>
  );
}

export function ListaAtendimentos({
  itens,
  comDia,
  hoje,
}: {
  itens: ItemAgenda[];
  comDia?: boolean;
  hoje?: string;
}) {
  return (
    <ul className="flex flex-col gap-2">
      {itens.map((a) => {
        const amanha = comDia && hoje && formatarNoFuso(a.inicio, "yyyy-MM-dd") !== hoje;
        return (
          <li key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            <span className="w-24 font-medium tabular-nums">
              {amanha ? "amanhã " : ""}
              {formatarNoFuso(a.inicio, "HH:mm")}
            </span>
            <span className="min-w-0 flex-1">
              {a.clienteNome} · {a.servicoNome}
              <span className="text-muted-foreground"> · {a.profissionalNome}</span>
            </span>
            <Badge variant="outline" className={cn(COR_STATUS[a.status].fundo)}>
              {COR_STATUS[a.status].rotulo}
            </Badge>
          </li>
        );
      })}
    </ul>
  );
}

export function ListaAniversariantes({ itens }: { itens: Aniversariante[] }) {
  return (
    <ul className="flex flex-col gap-2">
      {itens.map((c) => (
        <li key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          <span className="w-12 font-medium tabular-nums">
            {c.dataNascimento ? c.dataNascimento.slice(8, 10) + "/" + c.dataNascimento.slice(5, 7) : ""}
          </span>
          <span className="min-w-0 flex-1">{c.nome}</span>
          <Button type="button" size="sm" variant="outline" disabled title="Disponível na Fase 3">
            Enviar WhatsApp
          </Button>
        </li>
      ))}
    </ul>
  );
}

export function ListaEstoqueBaixo({ itens }: { itens: (ProdutoEstoque & { unidade?: string })[] }) {
  return (
    <ul className="flex flex-col gap-2">
      {itens.map((p) => (
        <li key={p.id} className="flex items-center justify-between gap-3 text-sm">
          <span>{p.nome}</span>
          <span className="tabular-nums text-destructive">
            {p.estoque_atual} / mín. {p.estoque_minimo}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function ListaSemTermo({ itens }: { itens: ItemSemTermo[] }) {
  return (
    <ul className="flex flex-col gap-2">
      {itens.map((a) => (
        <li key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          <span className="w-24 font-medium tabular-nums">{formatarNoFuso(a.inicio, "dd/MM HH:mm")}</span>
          <span className="min-w-0 flex-1">
            {a.clienteNome} · {a.servicoNome}
          </span>
          <Link
            href={`/clientes/${a.clienteId}?aba=termos`}
            className="inline-flex min-h-11 items-center font-medium text-ouro-escuro underline-offset-4 hover:underline"
          >
            Abrir ficha
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function ListaPedidosOnline({ itens, agora }: { itens: PedidoAguardando[]; agora: Date }) {
  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col gap-2">
        {itens.map((p) => (
          <li key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            <span className="w-24 font-medium tabular-nums">{formatarNoFuso(p.inicio, "dd/MM HH:mm")}</span>
            <span className="min-w-0 flex-1">
              {p.nome} · {p.servicoNome}
            </span>
            <span className="text-xs text-ouro-escuro">{tempoRestante(p.expiraEm, agora)}</span>
          </li>
        ))}
      </ul>
      <Link
        href="/agenda/pedidos"
        className="inline-flex min-h-11 items-center self-start font-medium text-ouro-escuro underline-offset-4 hover:underline"
      >
        Ver pedidos online
      </Link>
    </div>
  );
}
