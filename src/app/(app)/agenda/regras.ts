import { contextoFalhou, type ResultadoAgendamento } from "./resultado";
import { janelaDeBusca, montarContextoAgenda } from "@/features/agenda/contexto";
import { calcularFim, MENSAGEM_VALIDACAO, validarAgendamento } from "@/lib/dominio/agenda";
import type { StatusAgendamento } from "@/lib/dominio/status";
import { combinarDataHora } from "@/lib/dominio/tempo";
import type { createClient } from "@/lib/supabase/server";

// Regras compartilhadas por salvarAgendamento e remarcarAgendamento: confere
// profissional e serviço ativos, monta o ContextoAgenda do banco para a
// profissional no dia de São Paulo e aplica validarAgendamento. A constraint
// de sobreposição do banco continua sendo a guarda final (23P01).

type Supabase = Awaited<ReturnType<typeof createClient>>;

export const STATUS_FINAIS: readonly StatusAgendamento[] = ["atendido", "faltou", "cancelado"];

export const MSG = {
  naoEncontrado: "Agendamento não encontrado.",
  finalizado: "Este atendimento já foi finalizado e não pode ser alterado.",
  profissional: "Profissional não encontrada ou inativa.",
  servico: "Serviço não encontrado ou inativo.",
  dataHora: "Data ou horário inválido.",
} as const;

export type Existente = {
  id: string;
  status: StatusAgendamento;
  servico_id: string;
  valor_previsto_centavos: number;
};

/** Carrega o agendamento a editar; erro de banco é lançado. */
export async function carregarExistente(supabase: Supabase, id: string): Promise<Existente | null> {
  const { data, error } = await supabase
    .from("agendamentos")
    .select("id, status, servico_id, valor_previsto_centavos")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

export type Proposta = {
  id?: string;
  profissionalId: string;
  servicoId: string;
  data: string;
  hora: string;
  forcarForaJornada: boolean;
};

export type Aprovado = {
  ok: true;
  inicio: Date;
  fim: Date;
  precoCentavos: number;
};

/**
 * Valida a proposta contra o banco. Devolve o intervalo e o preço do serviço,
 * ou o resultado de falha/aviso pronto para a action devolver.
 */
export async function aprovarProposta(
  supabase: Supabase,
  p: Proposta,
): Promise<Aprovado | Exclude<ResultadoAgendamento, { ok: true }>> {
  let inicio: Date;
  try {
    inicio = combinarDataHora(p.data, p.hora);
  } catch {
    return { ok: false, erro: MSG.dataHora };
  }

  const [prof, servico] = await Promise.all([
    supabase.from("colaboradores").select("id, ativo").eq("id", p.profissionalId).maybeSingle(),
    supabase
      .from("servicos")
      .select("id, duracao_min, preco_centavos, ativo")
      .eq("id", p.servicoId)
      .maybeSingle(),
  ]);
  if (prof.error || servico.error) return contextoFalhou;
  if (!prof.data?.ativo) return { ok: false, erro: MSG.profissional };
  if (!servico.data?.ativo) return { ok: false, erro: MSG.servico };

  const fim = calcularFim(inicio, servico.data.duracao_min);
  const janela = janelaDeBusca(p.data, fim);

  const [vinculos, jornadas, bloqueios, agendamentos] = await Promise.all([
    supabase.from("colaborador_servicos").select("servico_id").eq("colaborador_id", p.profissionalId),
    supabase
      .from("jornadas")
      .select("dia_semana, hora_inicio, hora_fim")
      .eq("colaborador_id", p.profissionalId),
    supabase
      .from("bloqueios_agenda")
      .select("inicio, fim")
      .eq("colaborador_id", p.profissionalId)
      .lt("inicio", janela.fim.toISOString())
      .gt("fim", janela.inicio.toISOString()),
    supabase
      .from("agendamentos")
      .select("id, inicio, fim, status")
      .eq("profissional_id", p.profissionalId)
      .lt("inicio", janela.fim.toISOString())
      .gt("fim", janela.inicio.toISOString()),
  ]);
  if (vinculos.error || jornadas.error || bloqueios.error || agendamentos.error) {
    return contextoFalhou;
  }

  const ctx = montarContextoAgenda({
    jornadas: jornadas.data ?? [],
    bloqueios: bloqueios.data ?? [],
    agendamentos: agendamentos.data ?? [],
    servicoIds: (vinculos.data ?? []).map((v) => v.servico_id),
  });
  const { erros, avisos } = validarAgendamento(
    { id: p.id, inicio, duracaoMin: servico.data.duracao_min, servicoId: p.servicoId },
    ctx,
  );
  if (erros.length > 0) return { ok: false, erro: MENSAGEM_VALIDACAO[erros[0]] };
  if (avisos.includes("fora_da_jornada") && !p.forcarForaJornada) {
    return { ok: false, aviso: "fora_da_jornada" };
  }

  return { ok: true, inicio, fim, precoCentavos: servico.data.preco_centavos };
}
