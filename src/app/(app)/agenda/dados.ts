import "server-only";
import { limitesDoDia } from "@/features/agenda/contexto";
import { montarDadosAgenda, type DadosAgenda } from "@/features/agenda/dados-agenda";
import { semanaDe, type Visao } from "@/features/agenda/grade";
import { exigirPerfil } from "@/lib/sessao";
import { createClient } from "@/lib/supabase/server";

/** Datas (yyyy-MM-dd) exibidas: o dia, ou a semana seg–dom que o contém. */
export function datasDaVisao(data: string, visao: Visao): string[] {
  return visao === "semana" ? semanaDe(data) : [data];
}

/**
 * Carrega tudo o que a agenda mostra no período. O RLS já limita a
 * profissional aos próprios agendamentos; montarDadosAgenda limita as colunas.
 * Erro de banco é lançado (vira a página de erro).
 */
export async function carregarAgenda(data: string, visao: Visao): Promise<DadosAgenda> {
  const { colaborador } = await exigirPerfil("dona", "recepcao", "profissional");

  const datas = datasDaVisao(data, visao);
  const inicio = limitesDoDia(datas[0]).inicio.toISOString();
  const fim = limitesDoDia(datas[datas.length - 1]).fim.toISOString();

  const supabase = await createClient();
  const gerencia = colaborador.perfil !== "profissional";
  const [colaboradores, vinculos, servicos, jornadas, bloqueios, agendamentos, config, semPagamento] =
    await Promise.all([
      // Inclui inativas: quem tem atendimento no período continua com coluna.
      supabase.from("colaboradores").select("id, nome, cor, ativo").order("nome"),
      supabase.from("colaborador_servicos").select("colaborador_id, servico_id"),
      supabase.from("servicos").select("id, nome, duracao_min, preco_centavos, ativo, modelo_termo_id"),
      supabase.from("jornadas").select("colaborador_id, dia_semana, hora_inicio, hora_fim"),
      supabase
        .from("bloqueios_agenda")
        .select("id, colaborador_id, inicio, fim, motivo")
        .lt("inicio", fim)
        .gt("fim", inicio),
      supabase
        .from("agendamentos")
        .select(
          "id, profissional_id, cliente_id, servico_id, inicio, fim, status, observacoes, valor_previsto_centavos, clientes(nome)",
        )
        .lt("inicio", fim)
        .gt("fim", inicio)
        .order("inicio"),
      supabase.from("configuracoes_clinica").select("horario_funcionamento").limit(1).maybeSingle(),
      // Atendidos sem pagamento: habilita "Lançar pagamento" nos detalhes.
      gerencia
        ? supabase.rpc("agendamentos_sem_pagamento_periodo", {
            p_de: datas[0],
            p_ate: datas[datas.length - 1],
          })
        : Promise.resolve({ data: [] as string[], error: null }),
    ]);

  // Situação da ficha (alerta e pendência) das clientes do período: só indicadores.
  const clienteIds = [...new Set((agendamentos.data ?? []).map((a) => a.cliente_id))];
  const situacao = clienteIds.length
    ? await supabase.rpc("situacao_ficha", { p_clientes: clienteIds })
    : { data: [], error: null };

  // Atendimentos do período cujo serviço exige termo ainda não assinado (só o indicador).
  const agendamentoIds = (agendamentos.data ?? []).map((a) => a.id);
  const termos = agendamentoIds.length
    ? await supabase.rpc("agendamentos_com_termo_pendente", { p_ids: agendamentoIds })
    : { data: [] as string[], error: null };

  for (const r of [termos, situacao, colaboradores, vinculos, servicos, jornadas, bloqueios, agendamentos, config, semPagamento]) {
    if (r.error) throw new Error(`Falha ao carregar a agenda: ${r.error.message}`);
  }

  return montarDadosAgenda(
    {
      colaboradores: colaboradores.data ?? [],
      vinculos: vinculos.data ?? [],
      servicos: servicos.data ?? [],
      jornadas: jornadas.data ?? [],
      bloqueios: bloqueios.data ?? [],
      agendamentos: agendamentos.data ?? [],
      horarioFuncionamento: config.data?.horario_funcionamento ?? {},
      semPagamento: semPagamento.data ?? [],
      situacaoFicha: situacao.data ?? [],
      termoPendente: termos.data ?? [],
    },
    { perfil: colaborador.perfil, colaboradorId: colaborador.id },
    new Date(),
  );
}
