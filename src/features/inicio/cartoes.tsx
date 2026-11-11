import type { ReactNode } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { COR_STATUS } from "@/lib/dominio/status";
import { formatarNoFuso } from "@/lib/dominio/tempo";
import { cn } from "@/lib/utils";
import type { ContaVencendo } from "@/features/avisos/dados";
import { textoAviso } from "@/features/avisos/texto";
import { BotaoEnviarWhatsapp } from "@/features/mensagens/dialogo-enviar";
import { ItemResposta } from "@/features/mensagens/lista-respostas";
import { tempoRestante } from "@/features/pedidos/prazo";
import type { Resposta } from "@/app/(app)/mensagens/dados";
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
          {c.whatsapp ? (
            <BotaoEnviarWhatsapp clienteId={c.id} clienteNome={c.nome} tamanho="sm" />
          ) : (
            <span className="text-xs text-muted-foreground">Sem WhatsApp</span>
          )}
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

export function ListaContasVencendo({ itens }: { itens: ContaVencendo[] }) {
  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col divide-y">
        {itens.map((a) => (
          <li key={a.chave}>
            <Link
              href={a.href}
              className={cn(
                "flex min-h-11 items-center py-2 text-sm hover:bg-accent/50",
                a.dias < 0 && "text-destructive",
              )}
            >
              {textoAviso(a.conta, a.texto)}
            </Link>
          </li>
        ))}
      </ul>
      <Link
        href="/financeiro"
        className="inline-flex min-h-11 items-center self-start font-medium text-ouro-escuro underline-offset-4 hover:underline"
      >
        Ver Financeiro
      </Link>
    </div>
  );
}

/** Alerta do topo do Início: envio ligado e a Z-API fora do ar (ou sem chaves). */
export function AlertaWhatsappDesconectado({
  ehDona,
  semChaves = false,
}: {
  ehDona: boolean;
  semChaves?: boolean;
}) {
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center gap-3 rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="font-semibold text-destructive">
          {semChaves ? "Chaves da Z-API não configuradas" : "WhatsApp desconectado"}
        </p>
        <p>
          {semChaves
            ? "As mensagens automáticas estão paradas na fila. Cadastre as chaves da Z-API no servidor (Vercel)."
            : "As mensagens automáticas estão paradas na fila. Reconecte o número da clínica no painel da Z-API."}
        </p>
      </div>
      {ehDona && (
        <Link
          href="/configuracoes#whatsapp"
          className="inline-flex min-h-11 items-center font-medium text-ouro-escuro underline-offset-4 hover:underline"
        >
          Ver configurações
        </Link>
      )}
    </div>
  );
}

export function ListaRespostasWhatsapp({ itens }: { itens: Resposta[] }) {
  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col divide-y">
        {itens.map((r) => (
          <li key={r.id} className="py-2 first:pt-0">
            <ItemResposta r={r} />
          </li>
        ))}
      </ul>
      <Link
        href="/mensagens?aba=respostas"
        className="inline-flex min-h-11 items-center self-start font-medium text-ouro-escuro underline-offset-4 hover:underline"
      >
        Ver respostas
      </Link>
    </div>
  );
}

export function ResumoFalhasWhatsapp({ falhas }: { falhas: number }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-destructive">
        {falhas === 1
          ? "1 mensagem falhou nos últimos 7 dias."
          : `${falhas} mensagens falharam nos últimos 7 dias.`}
      </p>
      <Link
        href="/mensagens?aba=fila&status=falhou"
        className="inline-flex min-h-11 items-center self-start font-medium text-ouro-escuro underline-offset-4 hover:underline"
      >
        Ver na fila
      </Link>
    </div>
  );
}
