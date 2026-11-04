// Tipos que a tela da agenda recebe do servidor e a montagem pura deles a
// partir das linhas do banco (testável sem Supabase). Tudo serializável:
// instantes como ISO string, horas como "HH:mm".

import {
  agruparJornadasPorDia,
  horarioDoBanco,
  type IntervalosPorDia,
} from "@/lib/dominio/intervalos";
import type { Perfil } from "@/lib/dominio/permissoes";
import type { StatusAgendamento } from "@/lib/dominio/status";

export type ProfissionalAgenda = {
  id: string;
  nome: string;
  cor: string;
  servicoIds: string[];
  ativa: boolean;
  /** false: coluna só aparece porque já há atendimentos (inativa ou sem serviço ativo). */
  aceitaAgendamento: boolean;
};

export type ServicoAgenda = {
  id: string;
  nome: string;
  duracaoMin: number;
  precoCentavos: number;
  ativo: boolean;
};

export type AgendamentoAgenda = {
  id: string;
  profissionalId: string;
  clienteId: string;
  clienteNome: string;
  servicoId: string;
  servicoNome: string;
  inicio: string;
  fim: string;
  status: StatusAgendamento;
  observacoes: string | null;
  valorPrevistoCentavos: number;
  /** Atendido e ainda sem pagamento (só calculado para dona/recepção). */
  semPagamento: boolean;
};

export type BloqueioAgenda = {
  id: string;
  profissionalId: string;
  inicio: string;
  fim: string;
  motivo: string;
};

export type DadosAgenda = {
  profissionais: ProfissionalAgenda[];
  servicos: ServicoAgenda[];
  agendamentos: AgendamentoAgenda[];
  /** Jornada de cada profissional por dia da semana ("0".."6"). */
  jornadas: Record<string, IntervalosPorDia>;
  bloqueios: BloqueioAgenda[];
  horarioFuncionamento: IntervalosPorDia;
};

export type LinhasAgenda = {
  colaboradores: { id: string; nome: string; cor: string; ativo: boolean }[];
  vinculos: { colaborador_id: string; servico_id: string }[];
  servicos: { id: string; nome: string; duracao_min: number; preco_centavos: number; ativo: boolean }[];
  jornadas: { colaborador_id: string; dia_semana: number; hora_inicio: string; hora_fim: string }[];
  bloqueios: { id: string; colaborador_id: string; inicio: string; fim: string; motivo: string }[];
  agendamentos: {
    id: string;
    profissional_id: string;
    cliente_id: string;
    servico_id: string;
    inicio: string;
    fim: string;
    status: StatusAgendamento;
    observacoes: string | null;
    valor_previsto_centavos: number;
    clientes: { nome: string } | null;
  }[];
  horarioFuncionamento: unknown;
  /** Ids de atendidos sem pagamento no período (agendamentos_sem_pagamento_periodo). */
  semPagamento?: string[];
};

/**
 * Colunas, por nome: colaboradoras ativas que realizam ao menos um serviço
 * ativo (aceitam agendamento) e também qualquer colaboradora — inativa ou sem
 * serviço ativo — com atendimento não cancelado no período, para que ninguém
 * perca de vista (nem deixe de remarcar/cancelar) o que já está marcado.
 * A profissional logada vê só a própria coluna (o RLS também limita os
 * agendamentos dela).
 */
export function montarDadosAgenda(
  linhas: LinhasAgenda,
  sessao: { perfil: Perfil; colaboradorId: string },
): DadosAgenda {
  const servicosAtivos = new Set(linhas.servicos.filter((s) => s.ativo).map((s) => s.id));
  const servicosPorColab = new Map<string, string[]>();
  for (const v of linhas.vinculos) {
    if (!servicosAtivos.has(v.servico_id)) continue;
    servicosPorColab.set(v.colaborador_id, [...(servicosPorColab.get(v.colaborador_id) ?? []), v.servico_id]);
  }

  const comAtendimento = new Set(
    linhas.agendamentos.filter((a) => a.status !== "cancelado").map((a) => a.profissional_id),
  );
  const aceita = (c: { id: string; ativo: boolean }) =>
    c.ativo && (servicosPorColab.get(c.id)?.length ?? 0) > 0;

  const profissionais = linhas.colaboradores
    .filter((c) =>
      sessao.perfil === "profissional"
        ? c.id === sessao.colaboradorId
        : aceita(c) || comAtendimento.has(c.id),
    )
    .map((c) => ({
      id: c.id,
      nome: c.nome,
      cor: c.cor,
      servicoIds: servicosPorColab.get(c.id) ?? [],
      ativa: c.ativo,
      aceitaAgendamento: aceita(c),
    }))
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  const visiveis = new Set(profissionais.map((p) => p.id));

  const nomeServico = new Map(linhas.servicos.map((s) => [s.id, s.nome]));
  const semPagamento = new Set(linhas.semPagamento ?? []);

  const jornadas: Record<string, IntervalosPorDia> = {};
  for (const p of profissionais) {
    jornadas[p.id] = agruparJornadasPorDia(
      linhas.jornadas
        .filter((j) => j.colaborador_id === p.id)
        .map((j) => ({ diaSemana: j.dia_semana, horaInicio: j.hora_inicio, horaFim: j.hora_fim })),
    );
  }

  return {
    profissionais,
    servicos: linhas.servicos
      .map((s) => ({
        id: s.id,
        nome: s.nome,
        duracaoMin: s.duracao_min,
        precoCentavos: s.preco_centavos,
        ativo: s.ativo,
      }))
      .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")),
    agendamentos: linhas.agendamentos
      .filter((a) => visiveis.has(a.profissional_id))
      .map((a) => ({
        id: a.id,
        profissionalId: a.profissional_id,
        clienteId: a.cliente_id,
        clienteNome: a.clientes?.nome ?? "Cliente",
        servicoId: a.servico_id,
        servicoNome: nomeServico.get(a.servico_id) ?? "Serviço",
        inicio: a.inicio,
        fim: a.fim,
        status: a.status,
        observacoes: a.observacoes,
        valorPrevistoCentavos: a.valor_previsto_centavos,
        semPagamento: semPagamento.has(a.id),
      })),
    jornadas,
    bloqueios: linhas.bloqueios
      .filter((b) => visiveis.has(b.colaborador_id))
      .map((b) => ({
        id: b.id,
        profissionalId: b.colaborador_id,
        inicio: b.inicio,
        fim: b.fim,
        motivo: b.motivo,
      })),
    horarioFuncionamento: horarioDoBanco(linhas.horarioFuncionamento),
  };
}
