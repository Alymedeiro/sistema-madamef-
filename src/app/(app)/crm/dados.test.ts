import { beforeEach, describe, expect, it, vi } from "vitest";
import { criarSupabaseFalso } from "@/test/supabase-falso";

vi.mock("server-only", () => ({}));

import { carregarAniversariantes, carregarLeads, carregarOpcoesLead, carregarModeloReativacao, carregarRetornos, carregarSumidas } from "./dados";

let falso = criarSupabaseFalso();
beforeEach(() => {
  falso = criarSupabaseFalso();
  falso.definirPadrao({ data: null, error: null });
});

const linhaRetorno = (extra: Record<string, unknown> = {}) => ({
  cliente_id: "c1",
  cliente_nome: "Ana Souza",
  whatsapp: "5511987654321",
  aceita_marketing: true,
  servico_id: "s1",
  servico_nome: "Botox",
  agendamento_id: "a1",
  ultimo_atendimento: "2026-05-01T15:00:00Z",
  data_retorno: "2026-11-12",
  retorno_enviado_em: null,
  ...extra,
});

describe("carregarRetornos", () => {
  it("pede até hoje + 7 e marca atrasado / semana", async () => {
    falso.responder("rpc:crm_retornos", {
      data: [
        linhaRetorno({ agendamento_id: "a0", data_retorno: "2026-11-10" }),
        linhaRetorno({ agendamento_id: "a1", data_retorno: "2026-11-12" }),
        linhaRetorno({ agendamento_id: "a2", data_retorno: "2026-11-19" }),
      ],
      error: null,
    });
    const r = await carregarRetornos(falso.cliente as never, "2026-11-12");
    expect(falso.chamadasRpc("crm_retornos")[0].args[0]).toEqual({ p_ate: "2026-11-19" });
    expect(r.map((x) => [x.agendamentoId, x.situacao])).toEqual([
      ["a0", "atrasado"],
      ["a1", "semana"],
      ["a2", "semana"],
    ]);
  });

  it("classifica o envio: enviado, sem WhatsApp, sem opt-in, livre", async () => {
    falso.responder("rpc:crm_retornos", {
      data: [
        linhaRetorno({ retorno_enviado_em: "2026-11-11T12:00:00Z" }),
        linhaRetorno({ whatsapp: null, aceita_marketing: false }),
        linhaRetorno({ aceita_marketing: false }),
        linhaRetorno(),
      ],
      error: null,
    });
    const r = await carregarRetornos(falso.cliente as never, "2026-11-12");
    expect(r.map((x) => x.envio)).toEqual(["enviado", "sem_whatsapp", "sem_optin", "livre"]);
  });

  it("erro do banco vira exceção", async () => {
    falso.responder("rpc:crm_retornos", { data: null, error: { message: "x" } });
    await expect(carregarRetornos(falso.cliente as never, "2026-11-12")).rejects.toThrow();
  });
});

describe("carregarSumidas", () => {
  it("mapeia e classifica a elegibilidade", async () => {
    falso.responder("rpc:crm_sumidas", {
      data: [
        {
          cliente_id: "c1",
          nome: "Bia",
          whatsapp: "5511987654321",
          aceita_marketing: true,
          ultimo_atendimento: "2026-05-01T15:00:00Z",
          dias_sem_vir: 195,
          reativacao_enviada_em: null,
        },
        {
          cliente_id: "c2",
          nome: "Carla",
          whatsapp: null,
          aceita_marketing: true,
          ultimo_atendimento: "2026-04-01T15:00:00Z",
          dias_sem_vir: 225,
          reativacao_enviada_em: "2026-11-01T12:00:00Z",
        },
      ],
      error: null,
    });
    const r = await carregarSumidas(falso.cliente as never);
    expect(r[0]).toMatchObject({ clienteId: "c1", nome: "Bia", diasSemVir: 195, envio: "livre" });
    expect(r[1]).toMatchObject({ clienteId: "c2", envio: "sem_whatsapp", reativacaoEnviadaEm: "2026-11-01T12:00:00Z" });
  });
});

describe("carregarAniversariantes", () => {
  it("junta o status da fila do ano do aniversário", async () => {
    falso.responder("clientes", {
      data: [
        { id: "c1", nome: "Ana", whatsapp: "5511987654321", aceita_whatsapp_marketing: true, data_nascimento: "1990-11-12" },
        { id: "c2", nome: "Bia", whatsapp: "5511911112222", aceita_whatsapp_marketing: true, data_nascimento: "1991-11-15" },
        { id: "c3", nome: "Cris", whatsapp: null, aceita_whatsapp_marketing: false, data_nascimento: "1992-11-30" },
      ],
      error: null,
    });
    falso.responder("fila_mensagens", {
      data: [
        { cliente_id: "c1", status: "pendente", agendado_para: "2026-11-12T12:00:00Z", enviada_em: null, criado_em: "2026-11-12T11:00:00Z" },
        // do ano anterior: não conta
        { cliente_id: "c2", status: "enviada", agendado_para: "2025-11-15T12:00:00Z", enviada_em: "2025-11-15T12:01:00Z", criado_em: "2025-11-15T11:00:00Z" },
      ],
      error: null,
    });
    const r = await carregarAniversariantes(falso.cliente as never, "2026-11-12");
    expect(r.map((x) => [x.clienteId, x.dia, x.idade, x.statusFila])).toEqual([
      ["c1", "2026-11-12", 36, "pendente"],
      ["c2", "2026-11-15", 35, null],
    ]);
    expect(r[0].envio).toBe("livre");
  });

  it("pagina as clientes de 1000 em 1000, ordenando por id, até a página incompleta", async () => {
    const cheia = Array.from({ length: 1000 }, (_, i) => ({
      id: `c${i}`,
      nome: "X",
      whatsapp: null,
      aceita_whatsapp_marketing: false,
      data_nascimento: "1990-01-01",
    }));
    falso.responder(
      "clientes",
      { data: cheia, error: null },
      {
        data: [
          { id: "z1", nome: "Zé", whatsapp: null, aceita_whatsapp_marketing: false, data_nascimento: "1990-11-13" },
        ],
        error: null,
      },
    );
    const r = await carregarAniversariantes(falso.cliente as never, "2026-11-12");
    expect(r.map((x) => x.clienteId)).toEqual(["z1"]);
    expect(falso.chamadasDe("clientes", "range").map((c) => c.args)).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
    expect(falso.chamadasDe("clientes", "order")[0].args).toEqual(["id"]);
  });

  it("sem aniversariantes não consulta a fila", async () => {
    falso.responder("clientes", { data: [], error: null });
    expect(await carregarAniversariantes(falso.cliente as never, "2026-11-12")).toEqual([]);
    expect(falso.chamadasDe("fila_mensagens")).toHaveLength(0);
  });
});

describe("carregarModeloReativacao", () => {
  it("cai no nome padrão da clínica se a leitura falhar", async () => {
    falso.responder("modelos_mensagem", { data: null, error: { message: "x" } });
    falso.responder("configuracoes_clinica", { data: null, error: { message: "x" } });
    const m = await carregarModeloReativacao(falso.cliente as never);
    expect(m.clinica).toBe("Madame Fê Clinic");
  });
});

describe("carregarLeads", () => {
  it("aplica o corte de 60 dias aos encerrados e mantém os abertos", async () => {
    falso.responder("leads", {
      data: [
        {
          id: "l1",
          nome: "Ana",
          whatsapp: null,
          etapa: "novo",
          origem: "Instagram",
          observacoes: null,
          perdido_motivo: null,
          servico_id: "s1",
          responsavel_id: null,
          cliente_id: null,
          criado_em: "2026-11-01T12:00:00Z",
          servicos: { nome: "Botox" },
          colaboradores: null,
        },
      ],
      error: null,
    });
    const r = await carregarLeads(falso.cliente as never, new Date("2026-11-12T12:00:00Z"));
    expect(falso.chamadasDe("leads", "or")[0].args[0]).toBe(
      "etapa.in.(novo,em_conversa,orcamento_enviado),atualizado_em.gte.2026-09-13T12:00:00.000Z",
    );
    expect(r[0]).toMatchObject({ id: "l1", servicoNome: "Botox", responsavelNome: null, etapa: "novo" });
  });
});

describe("carregarOpcoesLead", () => {
  it("lê serviços e colaboradoras ativos", async () => {
    falso.responder("servicos", { data: [{ id: "s1", nome: "Botox" }], error: null });
    falso.responder("colaboradores", { data: [{ id: "c1", nome: "Bia" }], error: null });
    expect(await carregarOpcoesLead(falso.cliente as never)).toEqual({
      servicos: [{ id: "s1", nome: "Botox" }],
      responsaveis: [{ id: "c1", nome: "Bia" }],
    });
  });

  it("inclui o serviço e o responsável atuais do lead mesmo inativos", async () => {
    falso.responder("servicos", { data: [{ id: "s1", nome: "Botox" }], error: null });
    falso.responder("colaboradores", { data: [{ id: "c1", nome: "Bia" }], error: null });
    const lead = { servicoId: "s9", servicoNome: "Peeling", responsavelId: "c9", responsavelNome: "Lia" };
    const r = await carregarOpcoesLead(falso.cliente as never, [lead as never]);
    expect(r.servicos).toContainEqual({ id: "s9", nome: "Peeling (inativo)" });
    expect(r.responsaveis).toContainEqual({ id: "c9", nome: "Lia (inativo)" });
    expect(r.servicos).toHaveLength(2);
  });
});
