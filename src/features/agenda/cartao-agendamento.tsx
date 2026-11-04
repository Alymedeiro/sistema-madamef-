"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useDraggable } from "@dnd-kit/core";
import { CalendarClock, FileUser, Wallet } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { alterarStatus } from "@/app/(app)/agenda/actions";
import { formatarBRL } from "@/lib/dominio/dinheiro";
import type { Perfil } from "@/lib/dominio/permissoes";
import { COR_STATUS, transicaoPermitida, type StatusAgendamento } from "@/lib/dominio/status";
import { formatarNoFuso, horaNoFuso } from "@/lib/dominio/tempo";
import { cn } from "@/lib/utils";
import type { AgendamentoAgenda } from "./dados-agenda";

const STATUS_FINAIS: readonly StatusAgendamento[] = ["atendido", "faltou", "cancelado"];

const ROTULO_ACAO: Partial<Record<StatusAgendamento, string>> = {
  confirmado: "Confirmar",
  atendido: "Marcar como atendido",
  faltou: "Marcar falta",
  cancelado: "Cancelar agendamento",
};
const DESTINOS: StatusAgendamento[] = ["confirmado", "atendido", "faltou", "cancelado"];

type PropsCartao = {
  agendamento: AgendamentoAgenda;
  corProfissional: string;
  /** Posição em px dentro da coluna. */
  estilo: React.CSSProperties;
  arrastavel: boolean;
  onAbrir: () => void;
};

/** Conteúdo visual do cartão (também usado na sombra do arrastar). */
export function ConteudoCartao({ agendamento: a }: { agendamento: AgendamentoAgenda }) {
  return (
    <>
      <span className="block truncate font-semibold">
        {horaNoFuso(a.inicio)}–{horaNoFuso(a.fim)} · {a.clienteNome}
      </span>
      <span className="block truncate">{a.servicoNome}</span>
      <span className="block truncate text-xs">{COR_STATUS[a.status].rotulo}</span>
    </>
  );
}

const CLASSE_CARTAO =
  "overflow-hidden rounded-md border border-l-4 px-2 py-1 text-left text-sm leading-tight shadow-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring";

/** Cartão posicionado na coluna. Toque abre os detalhes; arrastar remarca (≥1024 px). */
export function CartaoAgendamento({
  agendamento,
  corProfissional,
  estilo,
  arrastavel,
  onAbrir,
}: PropsCartao) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: agendamento.id,
    disabled: !arrastavel,
  });

  return (
    <button
      ref={setNodeRef}
      type="button"
      {...(arrastavel ? listeners : {})}
      {...(arrastavel ? attributes : {})}
      onClick={onAbrir}
      aria-label={`${horaNoFuso(agendamento.inicio)} ${agendamento.clienteNome}, ${agendamento.servicoNome}, ${COR_STATUS[agendamento.status].rotulo}`}
      data-status={agendamento.status}
      className={cn(
        CLASSE_CARTAO,
        "absolute z-10",
        COR_STATUS[agendamento.status].fundo,
        arrastavel && "cursor-grab touch-none",
        isDragging && "opacity-40",
      )}
      style={{ ...estilo, borderLeftColor: corProfissional }}
    >
      <ConteudoCartao agendamento={agendamento} />
    </button>
  );
}

/** Cópia que segue o ponteiro durante o arrastar. */
export function SombraCartao({
  agendamento,
  corProfissional,
  alturaPx,
}: {
  agendamento: AgendamentoAgenda;
  corProfissional: string;
  alturaPx: number;
}) {
  return (
    <div
      className={cn(CLASSE_CARTAO, "cursor-grabbing shadow-lg", COR_STATUS[agendamento.status].fundo)}
      style={{ height: alturaPx, borderLeftColor: corProfissional }}
    >
      <ConteudoCartao agendamento={agendamento} />
    </div>
  );
}

type PropsDetalhes = {
  agendamento: AgendamentoAgenda | null;
  profissionalNome: string;
  perfil: Perfil;
  onFechar: () => void;
  onRemarcar: (a: AgendamentoAgenda) => void;
  onAbrirPagamento: (a: AgendamentoAgenda) => void;
};

/** Menu do cartão: transições permitidas, "Remarcar" e "Abrir ficha". */
export function DetalhesAgendamento({
  agendamento: a,
  profissionalNome,
  perfil,
  onFechar,
  onRemarcar,
  onAbrirPagamento,
}: PropsDetalhes) {
  const router = useRouter();
  const [pendente, iniciar] = useTransition();
  const [confirmandoCancelamento, setConfirmandoCancelamento] = useState(false);

  function fechar() {
    setConfirmandoCancelamento(false);
    onFechar();
  }

  function mudar(para: StatusAgendamento) {
    if (!a) return;
    if (para === "cancelado" && !confirmandoCancelamento) {
      setConfirmandoCancelamento(true);
      return;
    }
    iniciar(async () => {
      const r = await alterarStatus(a.id, para);
      if (!r.ok) {
        toast.error(r.erro);
        router.refresh();
        return;
      }
      toast.success(`Status alterado para ${COR_STATUS[para].rotulo.toLowerCase()}.`);
      fechar();
      if (r.abrirPagamento) onAbrirPagamento(a);
    });
  }

  const destinos = a ? DESTINOS.filter((para) => transicaoPermitida(a.status, para, perfil)) : [];
  const podeRemarcar = !!a && perfil !== "profissional" && !STATUS_FINAIS.includes(a.status);
  // Atendido que ficou sem pagamento (ex.: "Pagar depois"): lança no caixa de hoje.
  const podePagar = !!a && perfil !== "profissional" && a.status === "atendido" && a.semPagamento;

  return (
    <Dialog open={!!a} onOpenChange={(aberto) => !aberto && fechar()}>
      <DialogContent>
        {a && (
          <>
            <DialogHeader>
              <DialogTitle>{a.clienteNome}</DialogTitle>
              <DialogDescription>
                {a.servicoNome} com {profissionalNome}
              </DialogDescription>
            </DialogHeader>

            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="text-muted-foreground">Quando</dt>
              <dd>
                {formatarNoFuso(a.inicio, "EEEE, dd/MM")} · {horaNoFuso(a.inicio)}–{horaNoFuso(a.fim)}
              </dd>
              <dt className="text-muted-foreground">Status</dt>
              <dd>
                <Badge className={cn("border", COR_STATUS[a.status].fundo)}>
                  {COR_STATUS[a.status].rotulo}
                </Badge>
              </dd>
              <dt className="text-muted-foreground">Valor previsto</dt>
              <dd>{formatarBRL(a.valorPrevistoCentavos)}</dd>
              {a.observacoes && (
                <>
                  <dt className="text-muted-foreground">Observações</dt>
                  <dd className="break-words whitespace-pre-line">{a.observacoes}</dd>
                </>
              )}
            </dl>

            {destinos.length > 0 && (
              <div className="flex flex-col gap-2">
                <p className="text-sm font-medium">Alterar status</p>
                <div className="flex flex-wrap gap-2">
                  {destinos.map((para) => (
                    <Button
                      key={para}
                      type="button"
                      variant={para === "cancelado" ? "destructive" : "outline"}
                      disabled={pendente}
                      onClick={() => mudar(para)}
                    >
                      {para === "cancelado" && confirmandoCancelamento
                        ? "Confirmar cancelamento"
                        : ROTULO_ACAO[para]}
                    </Button>
                  ))}
                </div>
              </div>
            )}

            <div className="flex flex-wrap gap-2 border-t pt-4">
              {podePagar && (
                <Button
                  type="button"
                  onClick={() => {
                    fechar();
                    onAbrirPagamento(a);
                  }}
                >
                  <Wallet aria-hidden />
                  Lançar pagamento
                </Button>
              )}
              {podeRemarcar && (
                <Button type="button" variant="secondary" onClick={() => onRemarcar(a)}>
                  <CalendarClock aria-hidden />
                  Remarcar
                </Button>
              )}
              <Button asChild variant="link">
                <Link href={`/clientes/${a.clienteId}`}>
                  <FileUser aria-hidden />
                  Abrir ficha
                </Link>
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
