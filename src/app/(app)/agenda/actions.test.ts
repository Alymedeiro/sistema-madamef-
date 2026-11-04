import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Perfil } from "@/lib/dominio/permissoes";
import { criarSupabaseFalso, type Resposta } from "@/test/supabase-falso";

let perfilAtual: Perfil | null = "recepcao";
const EU = "c0000000-0000-4000-8000-00000000000c";
// Reproduz o contrato de exigirPerfil: sem login → /login; perfil errado → /inicio.
const exigirPerfil = vi.fn(async (...perfis: Perfil[]) => {
  if (!perfilAtual) throw new Error("REDIRECT:/login");
  if (perfis.length > 0 && !perfis.includes(perfilAtual)) throw new Error("REDIRECT:/inicio");
  return { userId: "u1", colaborador: { id: EU, nome: "Teste", perfil: perfilAtual } };
});
vi.mock("@/lib/sessao", () => ({ exigirPerfil: (...p: Perfil[]) => exigirPerfil(...p) }));
const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => revalidatePath(...a) }));

let falso = criarSupabaseFalso();
const createClient = vi.fn(async () => falso.cliente);
vi.mock("@/lib/supabase/server", () => ({ createClient: () => createClient() }));

import { alterarStatus, remarcarAgendamento, salvarAgendamento } from "./actions";

const AG = "a0000000-0000-4000-8000-0000000000a1";
const CLIENTE = "c1111111-1111-4111-8111-111111111111";
const PROF = "b2222222-2222-4222-8222-222222222222";
const SERVICO = "d3333333-3333-4333-8333-333333333333";
const OUTRO_SERVICO = "e4444444-4444-4444-8444-444444444444";

// 2026-11-03 é terça (dia_semana 2). Jornada 09–12 e 13–18 (almoço 12–13).
const ok = (data: unknown): Resposta => ({ data, error: null });

function prepararContexto(
  opcoes: {
    profAtiva?: boolean;
    servicoAtivo?: boolean;
    agendamentos?: unknown[];
  } = {},
) {
  falso.responder("colaboradores", ok({ id: PROF, ativo: opcoes.profAtiva ?? true }));
  falso.responder(
    "servicos",
    ok({ id: SERVICO, duracao_min: 60, preco_centavos: 18000, ativo: opcoes.servicoAtivo ?? true }),
  );
  falso.responder("colaborador_servicos", ok([{ servico_id: SERVICO }]));
  falso.responder(
    "jornadas",
    ok([
      { dia_semana: 2, hora_inicio: "09:00:00", hora_fim: "12:00:00" },
      { dia_semana: 2, hora_inicio: "13:00:00", hora_fim: "18:00:00" },
    ]),
  );
  falso.responder("bloqueios_agenda", ok([]));
  falso.responder("agendamentos", ok(opcoes.agendamentos ?? []));
}

const novo = {
  clienteId: CLIENTE,
  profissionalId: PROF,
  servicoId: SERVICO,
  data: "2026-11-03",
  hora: "09:00",
  observacoes: "  Primeira vez ",
};

beforeEach(() => {
  perfilAtual = "recepcao";
  falso = criarSupabaseFalso();
  exigirPerfil.mockClear();
  createClient.mockClear();
  revalidatePath.mockClear();
});

describe("guarda de perfil", () => {
  it("profissional não pode chamar salvarAgendamento nem remarcarAgendamento", async () => {
    perfilAtual = "profissional";
    await expect(salvarAgendamento(novo)).rejects.toThrow("REDIRECT:/inicio");
    await expect(remarcarAgendamento(AG, PROF, "2026-11-03", "10:00")).rejects.toThrow(
      "REDIRECT:/inicio",
    );
    expect(exigirPerfil).toHaveBeenCalledWith("dona", "recepcao");
    expect(createClient).not.toHaveBeenCalled();
    expect(falso.chamadas).toHaveLength(0);
  });

  it("alterarStatus aceita os três perfis", async () => {
    perfilAtual = null;
    await expect(alterarStatus(AG, "confirmado")).rejects.toThrow("REDIRECT:/login");
    expect(exigirPerfil).toHaveBeenCalledWith("dona", "recepcao", "profissional");
  });
});

describe("salvarAgendamento", () => {
  it("valida a entrada sem tocar no banco", async () => {
    expect(await salvarAgendamento({ ...novo, hora: "09:07" })).toEqual({
      ok: false,
      erro: "Escolha um horário em intervalos de 5 minutos.",
    });
    expect((await salvarAgendamento({ ...novo, clienteId: "x" })).ok).toBe(false);
    expect((await salvarAgendamento({ ...novo, data: "2026-02-30" })).ok).toBe(false);
    expect(falso.chamadas).toHaveLength(0);
  });

  it("cria com fim e valor previsto do serviço, no fuso de São Paulo", async () => {
    prepararContexto();
    falso.responder("agendamentos", ok({ id: AG }));
    const r = await salvarAgendamento(novo);
    expect(r).toEqual({ ok: true, id: AG });

    const linha = falso.chamadasDe("agendamentos", "insert")[0].args[0];
    expect(linha).toEqual({
      cliente_id: CLIENTE,
      profissional_id: PROF,
      servico_id: SERVICO,
      inicio: "2026-11-03T12:00:00.000Z",
      fim: "2026-11-03T13:00:00.000Z",
      observacoes: "Primeira vez",
      valor_previsto_centavos: 18000,
    });
    expect(revalidatePath).toHaveBeenCalledWith("/agenda");
  });

  it("busca o contexto da profissional no dia de São Paulo", async () => {
    prepararContexto();
    falso.responder("agendamentos", ok({ id: AG }));
    await salvarAgendamento(novo);
    const filtros = falso.chamadasDe("agendamentos").map((c) => [c.metodo, ...c.args]);
    expect(filtros).toContainEqual(["eq", "profissional_id", PROF]);
    expect(filtros).toContainEqual(["lt", "inicio", "2026-11-04T03:00:00.000Z"]);
    expect(filtros).toContainEqual(["gt", "fim", "2026-11-03T03:00:00.000Z"]);
    expect(falso.chamadasDe("jornadas", "eq")[0].args).toEqual(["colaborador_id", PROF]);
  });

  it("recusa sobreposição detectada na validação, sem inserir", async () => {
    prepararContexto({
      agendamentos: [
        {
          id: "outro",
          inicio: "2026-11-03T12:30:00+00:00",
          fim: "2026-11-03T13:30:00+00:00",
          status: "pendente",
        },
      ],
    });
    expect(await salvarAgendamento(novo)).toEqual({
      ok: false,
      erro: "Este horário já está ocupado para esta profissional.",
    });
    expect(falso.chamadasDe("agendamentos", "insert")).toHaveLength(0);
  });

  it("traduz o 23P01 do banco (duas pessoas marcando ao mesmo tempo)", async () => {
    prepararContexto();
    falso.responder("agendamentos", {
      data: null,
      error: { code: "23P01", message: "conflicting key value violates exclusion constraint" },
    });
    expect(await salvarAgendamento(novo)).toEqual({
      ok: false,
      erro: "Este horário já está ocupado para esta profissional.",
    });
  });

  it("fora da jornada devolve aviso sem forçar e grava quando forçado", async () => {
    prepararContexto();
    expect(await salvarAgendamento({ ...novo, hora: "12:30" })).toEqual({
      ok: false,
      aviso: "fora_da_jornada",
    });
    expect(falso.chamadasDe("agendamentos", "insert")).toHaveLength(0);

    prepararContexto();
    falso.responder("agendamentos", ok({ id: AG }));
    const r = await salvarAgendamento({ ...novo, hora: "12:30", forcarForaJornada: true });
    expect(r).toEqual({ ok: true, id: AG });
    expect(falso.chamadasDe("agendamentos", "insert")).toHaveLength(1);
  });

  it("recusa profissional inativa e serviço inativo", async () => {
    prepararContexto({ profAtiva: false });
    expect(await salvarAgendamento(novo)).toEqual({
      ok: false,
      erro: "Profissional não encontrada ou inativa.",
    });
    falso = criarSupabaseFalso();
    prepararContexto({ servicoAtivo: false });
    expect(await salvarAgendamento(novo)).toEqual({
      ok: false,
      erro: "Serviço não encontrado ou inativo.",
    });
  });

  it("recusa serviço que a profissional não realiza", async () => {
    prepararContexto();
    expect(await salvarAgendamento({ ...novo, servicoId: OUTRO_SERVICO })).toEqual({
      ok: false,
      erro: "Esta profissional não realiza este serviço.",
    });
  });

  it("edição mantém o valor quando o serviço não muda e ignora o próprio horário", async () => {
    falso.responder(
      "agendamentos",
      ok({ id: AG, status: "pendente", servico_id: SERVICO, valor_previsto_centavos: 15000 }),
    );
    prepararContexto({
      agendamentos: [
        { id: AG, inicio: "2026-11-03T12:00:00+00:00", fim: "2026-11-03T13:00:00+00:00", status: "pendente" },
      ],
    });
    falso.responder("agendamentos", ok([{ id: AG }]));
    const r = await salvarAgendamento({ ...novo, id: AG, hora: "09:30" });
    expect(r).toEqual({ ok: true, id: AG });
    const upd = falso.chamadasDe("agendamentos", "update")[0].args[0] as Record<string, unknown>;
    expect(upd.inicio).toBe("2026-11-03T12:30:00.000Z");
    expect(upd).not.toHaveProperty("valor_previsto_centavos");
  });

  it("não edita atendimento finalizado", async () => {
    falso.responder(
      "agendamentos",
      ok({ id: AG, status: "atendido", servico_id: SERVICO, valor_previsto_centavos: 15000 }),
    );
    expect(await salvarAgendamento({ ...novo, id: AG })).toEqual({
      ok: false,
      erro: "Este atendimento já foi finalizado e não pode ser alterado.",
    });
    expect(falso.chamadasDe("agendamentos", "update")).toHaveLength(0);
  });
});

describe("remarcarAgendamento", () => {
  function prepararExistente(status = "confirmado") {
    falso.responder(
      "agendamentos",
      ok({ id: AG, status, servico_id: SERVICO, valor_previsto_centavos: 15000 }),
    );
  }

  it("move para outra hora mantendo o valor previsto", async () => {
    prepararExistente();
    prepararContexto();
    falso.responder("agendamentos", ok([{ id: AG }]));
    const r = await remarcarAgendamento(AG, PROF, "2026-11-03", "14:15");
    expect(r).toEqual({ ok: true, id: AG });
    const upd = falso.chamadasDe("agendamentos", "update")[0].args[0];
    expect(upd).toEqual({
      profissional_id: PROF,
      inicio: "2026-11-03T17:15:00.000Z",
      fim: "2026-11-03T18:15:00.000Z",
    });
  });

  it("aviso de jornada e 23P01 seguem as mesmas regras", async () => {
    prepararExistente();
    prepararContexto();
    expect(await remarcarAgendamento(AG, PROF, "2026-11-03", "12:00")).toEqual({
      ok: false,
      aviso: "fora_da_jornada",
    });

    prepararExistente();
    prepararContexto();
    falso.responder("agendamentos", { data: null, error: { code: "23P01", message: "x" } });
    expect(await remarcarAgendamento(AG, PROF, "2026-11-03", "12:00", true)).toEqual({
      ok: false,
      erro: "Este horário já está ocupado para esta profissional.",
    });
  });

  it("agendamento inexistente ou cancelado não é remarcado", async () => {
    falso.responder("agendamentos", ok(null));
    expect(await remarcarAgendamento(AG, PROF, "2026-11-03", "10:00")).toEqual({
      ok: false,
      erro: "Agendamento não encontrado.",
    });
    prepararExistente("cancelado");
    expect((await remarcarAgendamento(AG, PROF, "2026-11-03", "10:00")).ok).toBe(false);
    expect(falso.chamadasDe("agendamentos", "update")).toHaveLength(0);
  });
});

describe("alterarStatus", () => {
  const atual = (status: string, profissional_id = PROF) =>
    falso.responder("agendamentos", ok({ id: AG, status, profissional_id }));

  it("recusa transição proibida sem atualizar", async () => {
    atual("atendido");
    expect(await alterarStatus(AG, "pendente")).toEqual({
      ok: false,
      erro: "Esta mudança de status não é permitida.",
    });
    expect(falso.chamadasDe("agendamentos", "update")).toHaveLength(0);
  });

  it("profissional não cancela", async () => {
    perfilAtual = "profissional";
    atual("pendente", EU);
    expect((await alterarStatus(AG, "cancelado")).ok).toBe(false);
    expect(falso.chamadasDe("agendamentos", "update")).toHaveLength(0);
  });

  it("profissional só altera os próprios atendimentos", async () => {
    perfilAtual = "profissional";
    atual("confirmado", PROF);
    expect(await alterarStatus(AG, "atendido")).toEqual({
      ok: false,
      erro: "Você não tem permissão para esta ação.",
    });

    atual("confirmado", EU);
    falso.responder("agendamentos", ok([{ id: AG }]));
    expect(await alterarStatus(AG, "atendido")).toEqual({
      ok: true,
      abrirPagamento: false,
      termoPendente: false,
    });
  });

  it("atualiza de forma otimista e abre pagamento para a recepção", async () => {
    atual("confirmado");
    falso.responder("agendamentos", ok([{ id: AG }]));
    expect(await alterarStatus(AG, "atendido")).toEqual({
      ok: true,
      abrirPagamento: true,
      termoPendente: false,
    });

    const filtros = falso
      .chamadasDe("agendamentos")
      .filter((c) => c.metodo === "update" || c.metodo === "eq")
      .map((c) => [c.metodo, ...c.args]);
    expect(filtros).toContainEqual(["update", { status: "atendido" }]);
    expect(filtros).toContainEqual(["eq", "status", "confirmado"]);
    expect(revalidatePath).toHaveBeenCalledWith("/agenda");
  });

  it("atendido com termo pendente: avisa, e o pagamento continua abrindo", async () => {
    atual("confirmado");
    falso.responder("agendamentos", ok([{ id: AG }]));
    falso.responder("rpc:agendamentos_com_termo_pendente", ok([AG]));
    expect(await alterarStatus(AG, "atendido")).toEqual({
      ok: true,
      abrirPagamento: true,
      termoPendente: true,
    });
    expect(falso.chamadasRpc("agendamentos_com_termo_pendente")[0].args[0]).toEqual({ p_ids: [AG] });
  });

  it("falha na consulta do termo não desfaz o status", async () => {
    atual("confirmado");
    falso.responder("agendamentos", ok([{ id: AG }]));
    falso.responder("rpc:agendamentos_com_termo_pendente", {
      data: null,
      error: { code: "XX000", message: "boom" },
    });
    expect(await alterarStatus(AG, "atendido")).toEqual({
      ok: true,
      abrirPagamento: true,
      termoPendente: false,
    });
  });

  it("outros status não consultam o termo", async () => {
    atual("confirmado");
    falso.responder("agendamentos", ok([{ id: AG }]));
    expect(await alterarStatus(AG, "faltou")).toEqual({
      ok: true,
      abrirPagamento: false,
      termoPendente: false,
    });
    expect(falso.chamadasRpc("agendamentos_com_termo_pendente")).toHaveLength(0);
  });

  it("avisa quando outra pessoa mudou o status antes", async () => {
    atual("pendente");
    falso.responder("agendamentos", ok([]));
    expect(await alterarStatus(AG, "confirmado")).toEqual({
      ok: false,
      erro: "Este atendimento foi alterado por outra pessoa. Atualize a agenda.",
    });
  });

  it("valida id e status sem tocar no banco", async () => {
    expect((await alterarStatus("x", "confirmado")).ok).toBe(false);
    expect((await alterarStatus(AG, "sumiu" as never)).ok).toBe(false);
    expect(falso.chamadas).toHaveLength(0);
  });
});
