"use server";

import { revalidatePath } from "next/cache";
import { transicaoPermitida, type StatusAgendamento } from "@/lib/dominio/status";
import { mensagemErroBanco } from "@/lib/erros-db";
import { ERRO_INESPERADO } from "@/lib/resultado";
import { exigirPerfil } from "@/lib/sessao";
import { createClient } from "@/lib/supabase/server";
import { aprovarProposta, carregarExistente, MSG, STATUS_FINAIS } from "./regras";
import type { ResultadoAgendamento, ResultadoStatus } from "./resultado";
import {
  agendamentoSchema,
  alteracaoStatusSchema,
  remarcacaoSchema,
  type AgendamentoInput,
} from "./schemas";

// exigirPerfil redireciona lançando; por isso fica fora dos try/catch.

const erro = (mensagem: string) => ({ ok: false as const, erro: mensagem });

/** Cria (sem id) ou edita (com id) um agendamento. Só dona e recepção. */
export async function salvarAgendamento(dados: AgendamentoInput): Promise<ResultadoAgendamento> {
  await exigirPerfil("dona", "recepcao");

  const parsed = agendamentoSchema.safeParse(dados);
  if (!parsed.success) return erro(parsed.error.issues[0].message);
  const d = parsed.data;

  try {
    const supabase = await createClient();

    const existente = d.id ? await carregarExistente(supabase, d.id) : null;
    if (d.id && !existente) return erro(MSG.naoEncontrado);
    if (existente && STATUS_FINAIS.includes(existente.status)) return erro(MSG.finalizado);

    const aprovado = await aprovarProposta(supabase, {
      id: d.id,
      profissionalId: d.profissionalId,
      servicoId: d.servicoId,
      data: d.data,
      hora: d.hora,
      forcarForaJornada: d.forcarForaJornada,
    });
    if (!aprovado.ok) return aprovado;

    const linha = {
      cliente_id: d.clienteId,
      profissional_id: d.profissionalId,
      servico_id: d.servicoId,
      inicio: aprovado.inicio.toISOString(),
      fim: aprovado.fim.toISOString(),
      observacoes: d.observacoes,
    };

    let id: string;
    if (existente) {
      // Troca de serviço atualiza o valor previsto; senão, mantém o combinado.
      const mudouServico = existente.servico_id !== d.servicoId;
      const { data, error } = await supabase
        .from("agendamentos")
        .update(mudouServico ? { ...linha, valor_previsto_centavos: aprovado.precoCentavos } : linha)
        .eq("id", existente.id)
        .select("id");
      if (error) return erro(mensagemErroBanco(error));
      if (!data?.length) return erro(MSG.naoEncontrado);
      id = existente.id;
    } else {
      const { data, error } = await supabase
        .from("agendamentos")
        .insert({ ...linha, valor_previsto_centavos: aprovado.precoCentavos })
        .select("id")
        .single();
      if (error || !data) return erro(error ? mensagemErroBanco(error) : ERRO_INESPERADO);
      id = data.id;
    }

    revalidatePath("/agenda");
    return { ok: true, id };
  } catch {
    return erro(ERRO_INESPERADO);
  }
}

/** Move um agendamento (usado pelo arrastar). Mantém cliente, serviço e valor previsto. */
export async function remarcarAgendamento(
  id: string,
  profissionalId: string,
  data: string,
  hora: string,
  forcarForaJornada?: boolean,
): Promise<ResultadoAgendamento> {
  await exigirPerfil("dona", "recepcao");

  const parsed = remarcacaoSchema.safeParse({ id, profissionalId, data, hora, forcarForaJornada });
  if (!parsed.success) return erro(parsed.error.issues[0].message);
  const d = parsed.data;

  try {
    const supabase = await createClient();
    const existente = await carregarExistente(supabase, d.id);
    if (!existente) return erro(MSG.naoEncontrado);
    if (STATUS_FINAIS.includes(existente.status)) return erro(MSG.finalizado);

    const aprovado = await aprovarProposta(supabase, {
      id: d.id,
      profissionalId: d.profissionalId,
      servicoId: existente.servico_id,
      data: d.data,
      hora: d.hora,
      forcarForaJornada: d.forcarForaJornada,
    });
    if (!aprovado.ok) return aprovado;

    const { data: linhas, error } = await supabase
      .from("agendamentos")
      .update({
        profissional_id: d.profissionalId,
        inicio: aprovado.inicio.toISOString(),
        fim: aprovado.fim.toISOString(),
      })
      .eq("id", d.id)
      .select("id");
    if (error) return erro(mensagemErroBanco(error));
    if (!linhas?.length) return erro(MSG.naoEncontrado);

    revalidatePath("/agenda");
    return { ok: true, id: d.id };
  } catch {
    return erro(ERRO_INESPERADO);
  }
}

/**
 * Muda o status conferindo a transição com o perfil da sessão. A gravação é
 * otimista (`status = de`): se outra pessoa mudou antes, nada é gravado.
 */
export async function alterarStatus(
  id: string,
  para: StatusAgendamento,
): Promise<ResultadoStatus> {
  const { colaborador } = await exigirPerfil("dona", "recepcao", "profissional");

  const parsed = alteracaoStatusSchema.safeParse({ id, para });
  if (!parsed.success) return erro(parsed.error.issues[0].message);
  const d = parsed.data;

  try {
    const supabase = await createClient();
    const { data: atual, error: erroLeitura } = await supabase
      .from("agendamentos")
      .select("id, status, profissional_id")
      .eq("id", d.id)
      .maybeSingle();
    if (erroLeitura) return erro(mensagemErroBanco(erroLeitura));
    if (!atual) return erro(MSG.naoEncontrado);

    if (colaborador.perfil === "profissional" && atual.profissional_id !== colaborador.id) {
      return erro("Você não tem permissão para esta ação.");
    }
    if (!transicaoPermitida(atual.status, d.para, colaborador.perfil)) {
      return erro("Esta mudança de status não é permitida.");
    }

    const { data: linhas, error } = await supabase
      .from("agendamentos")
      .update({ status: d.para })
      .eq("id", d.id)
      .eq("status", atual.status)
      .select("id");
    if (error) return erro(mensagemErroBanco(error));
    if (!linhas?.length) {
      return erro("Este atendimento foi alterado por outra pessoa. Atualize a agenda.");
    }

    // O aviso de termo é informativo: se a consulta falhar, o status já gravado fica.
    let termoPendente = false;
    if (d.para === "atendido") {
      try {
        const { data: pendentes, error: erroTermo } = await supabase.rpc(
          "agendamentos_com_termo_pendente",
          { p_ids: [d.id] },
        );
        termoPendente = !erroTermo && (pendentes ?? []).includes(d.id);
      } catch {
        termoPendente = false;
      }
    }

    revalidatePath("/agenda");
    return {
      ok: true,
      abrirPagamento: d.para === "atendido" && colaborador.perfil !== "profissional",
      termoPendente,
    };
  } catch {
    return erro(ERRO_INESPERADO);
  }
}
