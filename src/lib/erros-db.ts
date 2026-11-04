// Traduz erros do Postgres/PostgREST em mensagens para a usuária (pt-BR).
// Nunca devolve texto técnico desconhecido; só mensagens de regra de negócio
// levantadas de propósito pelo banco (RAISE EXCEPTION → P0001).

export type ErroBanco = { code?: string; message?: string };

const MENSAGEM_PADRAO = "Não foi possível concluir. Tente novamente.";

export function mensagemErroBanco(erro: ErroBanco): string {
  switch (erro.code) {
    case "23P01":
      return "Este horário já está ocupado para esta profissional.";
    case "23505":
      if (erro.message?.includes("clientes_cpf_key")) {
        return "Já existe uma cliente cadastrada com este CPF.";
      }
      // Uma cobrança por atendimento e uma por pacote (0007): duplo toque ou
      // duas recepcionistas cobrando ao mesmo tempo.
      if (erro.message?.includes("cobrancas_agendamento_unico")) {
        return "Este atendimento já foi pago.";
      }
      if (erro.message?.includes("cobrancas_pacote_unico")) {
        return "Este pacote já foi pago.";
      }
      return "Já existe um registro com estes dados.";
    case "42501":
      return "Você não tem permissão para esta ação.";
    case "P0001":
      return erro.message?.trim() ? erro.message : MENSAGEM_PADRAO;
    default:
      return MENSAGEM_PADRAO;
  }
}
