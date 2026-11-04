import { ERRO_INESPERADO } from "@/lib/resultado";

/** Retorno de salvarAgendamento e remarcarAgendamento. */
export type ResultadoAgendamento =
  | { ok: true; id: string }
  | { ok: false; erro: string }
  | { ok: false; aviso: "fora_da_jornada" };

/** Retorno de alterarStatus. */
export type ResultadoStatus = { ok: true; abrirPagamento: boolean } | { ok: false; erro: string };

export const contextoFalhou: { ok: false; erro: string } = { ok: false, erro: ERRO_INESPERADO };
