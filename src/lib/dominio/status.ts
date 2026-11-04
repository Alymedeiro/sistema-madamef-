import type { Perfil } from "./permissoes";

export type StatusAgendamento = "pendente" | "confirmado" | "atendido" | "faltou" | "cancelado";

/** Rótulo e classes Tailwind (fundo, texto e borda com contraste AA) de cada status. */
export const COR_STATUS: Record<StatusAgendamento, { fundo: string; rotulo: string }> = {
  pendente: { fundo: "border-amber-300 bg-amber-100 text-amber-950", rotulo: "Pendente" },
  confirmado: { fundo: "border-sky-300 bg-sky-100 text-sky-950", rotulo: "Confirmado" },
  atendido: { fundo: "border-emerald-300 bg-emerald-100 text-emerald-950", rotulo: "Atendido" },
  faltou: { fundo: "border-rose-300 bg-rose-100 text-rose-950", rotulo: "Faltou" },
  cancelado: { fundo: "border-neutral-700 bg-neutral-700 text-white", rotulo: "Cancelado" },
};

const FLUXO: Record<StatusAgendamento, readonly StatusAgendamento[]> = {
  pendente: ["confirmado", "atendido", "faltou", "cancelado"],
  confirmado: ["atendido", "faltou", "cancelado"],
  atendido: [],
  faltou: [],
  cancelado: [],
};

const FINAIS: readonly StatusAgendamento[] = ["atendido", "faltou", "cancelado"];
const DESTINOS_PROFISSIONAL: readonly StatusAgendamento[] = ["confirmado", "atendido", "faltou"];

/** Espelha o gatilho de proteção do banco (migração 0003) para o perfil profissional. */
export function transicaoPermitida(
  de: StatusAgendamento,
  para: StatusAgendamento,
  perfil: Perfil,
): boolean {
  if (de === para) return false;
  if (perfil === "profissional" && !DESTINOS_PROFISSIONAL.includes(para)) return false;
  if (FLUXO[de].includes(para)) return true;
  return perfil === "dona" && FINAIS.includes(de) && para === "confirmado";
}
