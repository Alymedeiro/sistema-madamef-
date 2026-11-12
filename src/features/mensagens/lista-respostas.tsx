"use client";

import { useTransition } from "react";
import Link from "next/link";
import { Check } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { marcarRespostaLida } from "@/app/(app)/mensagens/actions";
import type { Resposta } from "@/app/(app)/mensagens/dados";
import { formatarTelefone } from "@/lib/dominio/telefone";
import { dataNoFuso, formatarNoFuso } from "@/lib/dominio/tempo";
import {
  ROTULO_CLASSIFICACAO,
  type ClassificacaoResposta,
} from "@/lib/dominio/whatsapp";
import { cn } from "@/lib/utils";

export const COR_CLASSIFICACAO: Record<ClassificacaoResposta, string> = {
  para_ler: "border-sky-300 bg-sky-50 text-sky-900",
  quer_remarcar: "border-amber-300 bg-amber-50 text-amber-900",
  confirmou: "border-emerald-300 bg-emerald-50 text-emerald-900",
};

/** Uma resposta: quem, quando, classificação, texto e ações (cartão do Início). */
export function ItemResposta({ r }: { r: Resposta }) {
  const lida = r.lidaEm !== null;
  return (
    <div
      className={cn(
        "flex flex-col gap-2 text-sm sm:flex-row sm:items-start",
        lida && "opacity-75",
      )}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">
            {r.clienteNome ?? "Número sem cadastro"}
          </span>
          <span className="text-muted-foreground tabular-nums">
            {formatarTelefone(r.telefone)}
          </span>
          <Badge
            variant="outline"
            className={cn(COR_CLASSIFICACAO[r.classificacao])}
          >
            {ROTULO_CLASSIFICACAO[r.classificacao]}
          </Badge>
        </div>
        <span className="text-xs text-muted-foreground tabular-nums">
          Recebida em {formatarNoFuso(r.recebidaEm, "dd/MM 'às' HH:mm")}
          {lida && r.lidaEm
            ? ` · lida em ${formatarNoFuso(r.lidaEm, "dd/MM 'às' HH:mm")}`
            : ""}
        </span>
        <p className="break-words whitespace-pre-line">{r.texto}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {r.agendamentoInicio && (
          <Link
            href={`/agenda?data=${dataNoFuso(r.agendamentoInicio)}`}
            className="inline-flex min-h-11 items-center px-2 font-medium text-ouro-escuro underline-offset-4 hover:underline"
          >
            Ver agendamento
          </Link>
        )}
        {r.clienteId && !r.agendamentoInicio && (
          <Link
            href={`/clientes/${r.clienteId}`}
            className="inline-flex min-h-11 items-center px-2 font-medium text-ouro-escuro underline-offset-4 hover:underline"
          >
            Abrir ficha
          </Link>
        )}
        {!lida && <BotaoMarcarLida id={r.id} />}
      </div>
    </div>
  );
}

export function BotaoMarcarLida({ id }: { id: string }) {
  const [pendente, iniciar] = useTransition();
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={pendente}
      onClick={() =>
        iniciar(async () => {
          const r = await marcarRespostaLida(id);
          if (!r.ok) toast.error(r.erro);
        })
      }
    >
      <Check aria-hidden />
      Marcar como lida
    </Button>
  );
}
