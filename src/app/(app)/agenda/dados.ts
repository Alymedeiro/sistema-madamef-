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
  const [colaboradores, vinculos, servicos, jornadas, bloqueios, agendamentos, config] =
    await Promise.all([
      supabase.from("colaboradores").select("id, nome, cor, ativo").eq("ativo", true).order("nome"),
      supabase.from("colaborador_servicos").select("colaborador_id, servico_id"),
      supabase.from("servicos").select("id, nome, duracao_min, preco_centavos, ativo"),
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
    ]);

  for (const r of [colaboradores, vinculos, servicos, jornadas, bloqueios, agendamentos, config]) {
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
    },
    { perfil: colaborador.perfil, colaboradorId: colaborador.id },
  );
}
