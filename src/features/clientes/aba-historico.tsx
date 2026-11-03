import { Badge } from "@/components/ui/badge";
import { formatarBRL } from "@/lib/dominio/dinheiro";
import { formatarNoFuso } from "@/lib/dominio/tempo";
import { cn } from "@/lib/utils";
import { STATUS_HISTORICO, type StatusAgendamento } from "./status";

export type AtendimentoHistorico = {
  id: string;
  inicio: string;
  status: StatusAgendamento;
  servico: string;
  profissional: string;
  valorPrevistoCentavos: number;
};

/** Agendamentos da cliente, do mais recente para o mais antigo (horário de São Paulo). */
export function AbaHistorico({ atendimentos }: { atendimentos: AtendimentoHistorico[] }) {
  if (atendimentos.length === 0) {
    return <p className="text-muted-foreground">Nenhum agendamento para esta cliente ainda.</p>;
  }
  return (
    <ul className="flex flex-col gap-3">
      {atendimentos.map((a) => {
        const status = STATUS_HISTORICO[a.status];
        return (
          <li
            key={a.id}
            className="flex flex-col gap-2 rounded-xl border bg-card p-4 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="min-w-0">
              <p className="font-medium">
                {formatarNoFuso(a.inicio, "dd/MM/yyyy")} às {formatarNoFuso(a.inicio, "HH:mm")}
              </p>
              <p className="text-sm break-words">{a.servico}</p>
              <p className="text-sm text-muted-foreground">com {a.profissional}</p>
            </div>
            <div className="flex items-center justify-between gap-3 sm:flex-col sm:items-end">
              <Badge variant="outline" className={cn(status.classes)}>
                {status.rotulo}
              </Badge>
              <p className="text-sm">
                <span className="text-muted-foreground">Previsto: </span>
                {formatarBRL(a.valorPrevistoCentavos)}
              </p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
