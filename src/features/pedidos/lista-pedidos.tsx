"use client";

import { useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatarTelefone } from "@/lib/dominio/telefone";
import { dataNoFuso, formatarNoFuso } from "@/lib/dominio/tempo";
import { cn } from "@/lib/utils";
import type { PedidoLista, ProfissionalPedido, StatusPedido } from "./dados";
import { DialogoAprovar } from "./dialogo-aprovar";
import { DialogoRecusar } from "./dialogo-recusar";
import { tempoRestante } from "./prazo";

const ABAS: { status: StatusPedido; rotulo: string; vazio: string }[] = [
  { status: "aguardando", rotulo: "Aguardando", vazio: "Nenhum pedido aguardando resposta." },
  { status: "aprovado", rotulo: "Aprovados", vazio: "Nenhum pedido aprovado." },
  { status: "recusado", rotulo: "Recusados", vazio: "Nenhum pedido recusado." },
  { status: "expirado", rotulo: "Expirados", vazio: "Nenhum pedido expirado." },
];

type Props = {
  status: StatusPedido;
  pedidos: PedidoLista[];
  profissionais: ProfissionalPedido[];
  /** Instante da renderização no servidor (ISO), para o tempo restante. */
  agora: string;
  /** ?pedido=<id>: abre a aprovação dele (se aguardando) ou o destaca. */
  pedidoAberto: string | null;
};

export function ListaPedidos({ status, pedidos, profissionais, agora, pedidoAberto }: Props) {
  const [aprovando, setAprovando] = useState<PedidoLista | null>(() =>
    status === "aguardando" ? (pedidos.find((p) => p.id === pedidoAberto) ?? null) : null,
  );
  const [recusando, setRecusando] = useState<PedidoLista | null>(null);
  const aba = ABAS.find((a) => a.status === status) ?? ABAS[0];

  return (
    <div className="flex flex-col gap-4">
      <nav aria-label="Filtrar pedidos" className="flex flex-wrap gap-1 rounded-lg bg-muted p-1 sm:w-fit">
        {ABAS.map((a) => (
          <Link
            key={a.status}
            href={`/agenda/pedidos?status=${a.status}`}
            aria-current={a.status === status ? "page" : undefined}
            className={cn(
              "inline-flex min-h-11 flex-1 items-center justify-center rounded-md px-4 text-sm font-medium text-muted-foreground sm:flex-none",
              a.status === status && "bg-card text-foreground shadow-sm",
            )}
          >
            {a.rotulo}
          </Link>
        ))}
      </nav>

      {pedidos.length === 0 ? (
        <p className="text-sm text-muted-foreground">{aba.vazio}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {pedidos.map((p) => (
            <li
              key={p.id}
              id={`pedido-${p.id}`}
              className={cn(
                "flex flex-col gap-3 rounded-xl border bg-card p-4 shadow-sm sm:flex-row sm:items-center",
                p.id === pedidoAberto && "ring-2 ring-ring",
              )}
            >
              <div className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{p.nome ?? "Dados apagados (LGPD)"}</span>
                  {p.whatsapp && (
                    <span className="text-muted-foreground tabular-nums">{formatarTelefone(p.whatsapp)}</span>
                  )}
                  {p.avaliacao && <Badge variant="outline">Avaliação</Badge>}
                </div>
                <span>
                  {p.servicoNome} · {p.profissionalNome}
                </span>
                <span className="font-medium tabular-nums">
                  {formatarNoFuso(p.inicio, "EEE, dd/MM 'às' HH:mm")}
                </span>
                <span className="text-xs text-muted-foreground">
                  Pedido em {formatarNoFuso(p.criadoEm, "dd/MM HH:mm")}
                  {p.status === "aguardando" && (
                    <> · <strong className="text-ouro-escuro">{tempoRestante(p.expiraEm, new Date(agora))}</strong></>
                  )}
                </span>
                {p.status === "recusado" && p.motivoRecusa && (
                  <span className="text-xs text-muted-foreground">Motivo: {p.motivoRecusa}</span>
                )}
              </div>

              {p.status === "aguardando" && (
                <div className="flex gap-2">
                  <Button type="button" variant="outline" onClick={() => setRecusando(p)}>
                    Recusar
                  </Button>
                  <Button type="button" onClick={() => setAprovando(p)}>
                    Aprovar
                  </Button>
                </div>
              )}
              {p.status === "aprovado" && (
                <Button asChild variant="outline">
                  <Link href={`/agenda?data=${dataNoFuso(p.inicio)}`}>Ver na agenda</Link>
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      <DialogoAprovar pedido={aprovando} profissionais={profissionais} onFechar={() => setAprovando(null)} />
      <DialogoRecusar pedido={recusando} onFechar={() => setRecusando(null)} />
    </div>
  );
}
