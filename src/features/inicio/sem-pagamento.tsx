"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { DialogoPagamento, type AtendimentoParaPagar } from "@/features/caixa/dialogo-pagamento";
import { formatarBRL } from "@/lib/dominio/dinheiro";
import { formatarNoFuso } from "@/lib/dominio/tempo";
import type { ItemSemPagamento } from "./dados";

export function ListaSemPagamento({ itens }: { itens: ItemSemPagamento[] }) {
  const [alvo, setAlvo] = useState<AtendimentoParaPagar | null>(null);

  return (
    <>
      <ul className="flex flex-col gap-2">
        {itens.map((a) => (
          <li key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            <span className="w-12 font-medium tabular-nums">{formatarNoFuso(a.inicio, "HH:mm")}</span>
            <span className="min-w-0 flex-1">
              {a.clienteNome} · {a.servicoNome}
              <span className="text-muted-foreground"> · {formatarBRL(a.valorPrevistoCentavos)}</span>
            </span>
            <Button
              type="button"
              size="sm"
              onClick={() =>
                setAlvo({
                  id: a.id,
                  clienteId: a.clienteId,
                  clienteNome: a.clienteNome,
                  valorPrevistoCentavos: a.valorPrevistoCentavos,
                })
              }
            >
              Lançar pagamento
            </Button>
          </li>
        ))}
      </ul>
      <DialogoPagamento atendimento={alvo} onFechar={() => setAlvo(null)} />
    </>
  );
}
