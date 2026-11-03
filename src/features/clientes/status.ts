import type { Database } from "@/lib/supabase/tipos";

export type StatusAgendamento = Database["public"]["Enums"]["status_agendamento"];

// Rótulo e cor do status no histórico da cliente. Local por enquanto: a Task 10
// introduz o mapa único (COR_STATUS) e pode substituir este.
export const STATUS_HISTORICO: Record<StatusAgendamento, { rotulo: string; classes: string }> = {
  pendente: { rotulo: "Pendente", classes: "border-amber-300 bg-amber-100 text-amber-950" },
  confirmado: { rotulo: "Confirmado", classes: "border-sky-300 bg-sky-100 text-sky-950" },
  atendido: { rotulo: "Atendido", classes: "border-emerald-300 bg-emerald-100 text-emerald-950" },
  faltou: { rotulo: "Faltou", classes: "border-red-300 bg-red-100 text-red-950" },
  cancelado: { rotulo: "Cancelado", classes: "border-zinc-400 bg-zinc-200 text-zinc-900" },
};
