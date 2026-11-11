// Libera um horário da agenda de uma profissional no projeto de testes, para os E2E rodarem
// de novo no mesmo dia. Desde a 0011 todo atendido ganha comissão (e talvez movimentos de
// estoque) com FK para o agendamento, e ninguém apaga essas linhas (nem o service_role): o
// agendamento não pode mais ser apagado. Em vez disso:
// - cancela (status 'cancelado'): sai da restrição de sobreposição, a comissão em aberto é
//   cancelada e o estoque baixado é estornado pelos gatilhos;
// - se a comissão já foi paga (o banco recusa desmarcar), muda inicio/fim para um minuto
//   "arquivado" no passado distante (2000–2009), único por agendamento. Editar o início de um
//   atendido com comissão paga é permitido (agendamentos_comissao só recalcula a aberta).
// Sem dependência do Playwright: dá para testar em e2e/horario-livre.unit.ts.
import type { SupabaseClient } from "@supabase/supabase-js";

export const MSG_COMISSAO_PAGA = "A comissão deste atendimento já foi paga.";

const INICIO_ARQUIVO_MS = Date.UTC(2000, 0, 1);
/** Minutos de 2000-01-01 a 2009-12-31: espaço dos horários arquivados. */
export const MINUTOS_ARQUIVO = 10 * 365 * 24 * 60;

/** Hash FNV-1a de 32 bits (determinístico, sem dependências). */
function hash(texto: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < texto.length; i++) {
    h ^= texto.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * Horário arquivado (1 minuto) do agendamento: derivado do id, com `tentativa` para pular
 * para o minuto seguinte se outro arquivado já ocupar aquele (23P01).
 */
export function horarioArquivado(agendamentoId: string, tentativa = 0): { inicio: string; fim: string } {
  const minuto = (hash(agendamentoId) + tentativa) % MINUTOS_ARQUIVO;
  const inicio = INICIO_ARQUIVO_MS + minuto * 60_000;
  return {
    inicio: new Date(inicio).toISOString(),
    fim: new Date(inicio + 60_000).toISOString(),
  };
}

type ErroPg = { code?: string; message?: string } | null;

const TENTATIVAS_ARQUIVO = 20;

/**
 * Libera [de, ate) da profissional: todo agendamento não cancelado que começa nesse intervalo
 * é cancelado ou, com a comissão paga, arquivado no passado. `de`/`ate` são timestamps com
 * fuso (ex.: `2026-11-16T15:00:00-03:00`). Lança se algo não puder ser liberado.
 */
export async function liberarHorario(
  admin: SupabaseClient,
  profissionalId: string,
  de: string,
  ate: string,
): Promise<void> {
  const { data, error } = await admin
    .from("agendamentos")
    .select("id")
    .eq("profissional_id", profissionalId)
    .neq("status", "cancelado")
    .gte("inicio", de)
    .lt("inicio", ate);
  if (error) throw error;

  for (const { id } of (data ?? []) as { id: string }[]) {
    const { error: ec } = (await admin
      .from("agendamentos")
      .update({ status: "cancelado" })
      .eq("id", id)) as { error: ErroPg };
    if (!ec) continue;
    if (ec.message !== MSG_COMISSAO_PAGA) throw ec;

    let ultimo: ErroPg = null;
    for (let tentativa = 0; tentativa < TENTATIVAS_ARQUIVO; tentativa++) {
      const { error: em } = (await admin
        .from("agendamentos")
        .update(horarioArquivado(id, tentativa))
        .eq("id", id)) as { error: ErroPg };
      if (!em) {
        ultimo = null;
        break;
      }
      ultimo = em;
      if (em.code !== "23P01") break;
    }
    if (ultimo) throw ultimo;
  }
}
