import { beforeEach, describe, expect, it, vi } from "vitest";
import { criarSupabaseFalso } from "@/test/supabase-falso";

vi.mock("server-only", () => ({}));

import {
  carregarAlertasWhatsapp,
  carregarRespostas,
  contarFalhasSemReenvio,
  type LinhaChave,
} from "./dados";

const ok = (data: unknown) => ({ data, error: null });
let falso = criarSupabaseFalso();

beforeEach(() => {
  falso = criarSupabaseFalso();
  falso.definirPadrao({ data: null, error: null });
});

const linhaResposta = {
  id: "r1",
  telefone: "5511987654321",
  texto: "Quero remarcar",
  recebida_em: "2026-11-10T13:00:00Z",
  classificacao: "para_ler",
  lida_em: null,
  cliente_id: "c1",
  agendamento_id: "a1",
  clientes: { nome: "Ana Souza" },
  agendamentos: { inicio: "2026-11-12T13:00:00Z" },
};

const falha = (extra: Partial<LinhaChave> = {}): LinhaChave => ({
  status: "falhou",
  tipo: "confirmacao",
  cliente_id: "c1",
  agendamento_id: "a1",
  pedido_online_id: null,
  criado_em: "2026-11-10T10:00:00Z",
  ...extra,
});

describe("contarFalhasSemReenvio", () => {
  it("não conta a falha que já tem uma mais nova viva com a mesma chave", () => {
    expect(
      contarFalhasSemReenvio([
        falha(),
        falha({ status: "pendente", criado_em: "2026-11-10T11:00:00Z" }),
      ]),
    ).toBe(0);
  });

  it("conta quando a viva é mais antiga, é de outra chave, ou a nova também falhou", () => {
    expect(
      contarFalhasSemReenvio([
        falha(),
        falha({ status: "enviada", criado_em: "2026-11-09T10:00:00Z" }),
        falha({ status: "pendente", tipo: "lembrete", criado_em: "2026-11-10T11:00:00Z" }),
        falha({ criado_em: "2026-11-10T12:00:00Z" }),
        falha({ tipo: "pedido_recusado", cliente_id: null, agendamento_id: null, pedido_online_id: "p1" }),
        falha({
          status: "enviada",
          tipo: "pedido_recusado",
          cliente_id: null,
          agendamento_id: null,
          pedido_online_id: "p1",
          criado_em: "2026-11-10T13:00:00Z",
        }),
      ]),
    ).toBe(2);
  });
});

describe("contarFalhasSemReenvio: lead e telefone", () => {
  const semCliente = { cliente_id: null, agendamento_id: null, pedido_online_id: null };
  it("reenvio para o mesmo lead apaga a falha; outro lead não", () => {
    const f = falha({ tipo: "avulsa", ...semCliente, lead_id: "l1" });
    expect(
      contarFalhasSemReenvio([
        f,
        falha({ tipo: "avulsa", ...semCliente, lead_id: "l1", status: "pendente", criado_em: "2026-11-10T11:00:00Z" }),
      ]),
    ).toBe(0);
    expect(
      contarFalhasSemReenvio([
        f,
        falha({ tipo: "avulsa", ...semCliente, lead_id: "l2", status: "pendente", criado_em: "2026-11-10T11:00:00Z" }),
      ]),
    ).toBe(1);
  });

  it("sem cliente, pedido nem lead: casa pelo telefone (com ou sem o 9)", () => {
    const f = falha({ tipo: "robo", ...semCliente, telefone: "552188887777" });
    expect(
      contarFalhasSemReenvio([
        f,
        falha({ tipo: "robo", ...semCliente, telefone: "5521988887777", status: "enviada", criado_em: "2026-11-10T11:00:00Z" }),
      ]),
    ).toBe(0);
    expect(
      contarFalhasSemReenvio([
        f,
        falha({ tipo: "robo", ...semCliente, telefone: "5521911112222", status: "enviada", criado_em: "2026-11-10T11:00:00Z" }),
      ]),
    ).toBe(1);
  });
});

describe("carregarAlertasWhatsapp", () => {
  it("com o envio desligado não acusa desconexão nem falta de chaves", async () => {
    falso.responder("configuracoes_clinica", ok({ whatsapp_ativo: false }));
    falso.responder("whatsapp_status", ok({ estado: "sem_chaves" }));
    falso.responder("fila_mensagens", ok([]));
    falso.responder("mensagens_recebidas", ok([]));
    const r = await carregarAlertasWhatsapp(falso.cliente as never);
    expect(r).toEqual({ desconectado: false, semChaves: false, falhas: 0, respostas: [] });
  });

  it("com o envio ligado e estado ≠ conectado acusa desconexão", async () => {
    for (const estado of ["desconectado", "sem_chaves"]) {
      falso.responder("configuracoes_clinica", ok({ whatsapp_ativo: true }));
      falso.responder("whatsapp_status", ok({ estado }));
      falso.responder("fila_mensagens", ok([1, 2, 3].map((i) => falha({ cliente_id: `c${i}` }))));
      falso.responder("mensagens_recebidas", ok([linhaResposta]));
      const r = await carregarAlertasWhatsapp(falso.cliente as never);
      expect(r.desconectado).toBe(true);
      expect(r.semChaves).toBe(estado === "sem_chaves");
      expect(r.falhas).toBe(3);
      expect(r.respostas).toEqual([
        {
          id: "r1",
          telefone: "5511987654321",
          texto: "Quero remarcar",
          recebidaEm: "2026-11-10T13:00:00Z",
          classificacao: "para_ler",
          lidaEm: null,
          clienteId: "c1",
          clienteNome: "Ana Souza",
          agendamentoId: "a1",
          agendamentoInicio: "2026-11-12T13:00:00Z",
        },
      ]);
    }
  });

  it("falhas de lead e de número sem cadastro: o reenvio procura por lead_id e telefone e apaga o alerta", async () => {
    const semCliente = { cliente_id: null, agendamento_id: null, pedido_online_id: null };
    falso.responder("configuracoes_clinica", ok({ whatsapp_ativo: true }));
    falso.responder("whatsapp_status", ok({ estado: "conectado" }));
    falso.responder(
      "fila_mensagens",
      ok([
        falha({ tipo: "avulsa", ...semCliente, lead_id: "l1", telefone: "5511911112222" }),
        falha({ tipo: "robo", ...semCliente, lead_id: null, telefone: "552188887777" }),
      ]),
      ok([
        falha({ tipo: "avulsa", ...semCliente, lead_id: "l1", status: "pendente", criado_em: "2026-11-10T11:00:00Z" }),
        falha({ tipo: "robo", ...semCliente, telefone: "5521988887777", status: "enviada", criado_em: "2026-11-10T11:00:00Z" }),
      ]),
    );
    falso.responder("mensagens_recebidas", ok([]));
    const r = await carregarAlertasWhatsapp(falso.cliente as never);
    expect(r.falhas).toBe(0);
    expect(falso.chamadasDe("fila_mensagens", "or")[0].args[0]).toBe(
      "lead_id.in.(l1),telefone.in.(552188887777,5521988887777)",
    );
  });

  it("conectado não acusa; falhas dos últimos 7 dias; respostas não lidas que pedem atenção", async () => {
    falso.responder("configuracoes_clinica", ok({ whatsapp_ativo: true }));
    falso.responder("whatsapp_status", ok({ estado: "conectado" }));
    const r = await carregarAlertasWhatsapp(falso.cliente as never, new Date("2026-11-11T12:00:00Z"));
    expect(r.desconectado).toBe(false);
    expect(falso.chamadasDe("fila_mensagens", "eq")[0].args).toEqual(["status", "falhou"]);
    expect(falso.chamadasDe("fila_mensagens", "gte")[0].args).toEqual([
      "atualizado_em",
      "2026-11-04T12:00:00.000Z",
    ]);
    expect(falso.chamadasDe("fila_mensagens", "order")[0].args).toEqual([
      "atualizado_em",
      { ascending: false },
    ]);
    // Sem falhas: não procura reenvios.
    expect(falso.chamadasDe("fila_mensagens", "select")).toHaveLength(1);
    expect(falso.chamadasDe("mensagens_recebidas", "is")[0].args).toEqual(["lida_em", null]);
    expect(falso.chamadasDe("mensagens_recebidas", "in")[0].args).toEqual([
      "classificacao",
      ["quer_remarcar", "para_ler"],
    ]);
  });

  it("falhas lidas à parte; reenvios procurados só para as chaves das falhas", async () => {
    falso.responder("configuracoes_clinica", ok({ whatsapp_ativo: true }));
    falso.responder("whatsapp_status", ok({ estado: "conectado" }));
    falso.responder(
      "fila_mensagens",
      ok([
        falha({ criado_em: "2026-11-10T10:00:00Z" }),
        falha({ cliente_id: "c2", agendamento_id: "a2", criado_em: "2026-11-09T10:00:00Z" }),
        falha({
          tipo: "pedido_recusado",
          cliente_id: null,
          agendamento_id: null,
          pedido_online_id: "p1",
          criado_em: "2026-11-10T08:00:00Z",
        }),
      ]),
      // Reenvio vivo só da primeira (c1/a1).
      ok([falha({ status: "pendente", criado_em: "2026-11-10T11:00:00Z" })]),
    );
    falso.responder("mensagens_recebidas", ok([]));
    const r = await carregarAlertasWhatsapp(falso.cliente as never, new Date("2026-11-11T12:00:00Z"));
    expect(r.falhas).toBe(2);
    expect(falso.chamadasDe("fila_mensagens", "in").map((c) => c.args)).toEqual([
      ["status", ["pendente", "enviando", "enviada"]],
      ["tipo", ["confirmacao", "pedido_recusado"]],
    ]);
    expect(falso.chamadasDe("fila_mensagens", "gt")[0].args).toEqual([
      "criado_em",
      "2026-11-09T10:00:00Z",
    ]);
    expect(falso.chamadasDe("fila_mensagens", "or")[0].args).toEqual([
      "cliente_id.in.(c1,c2),pedido_online_id.in.(p1)",
    ]);
  });

  it("erro ao procurar reenvios é lançado", async () => {
    falso.responder("configuracoes_clinica", ok({ whatsapp_ativo: true }));
    falso.responder("whatsapp_status", ok({ estado: "conectado" }));
    falso.responder("fila_mensagens", ok([falha()]), { data: null, error: { message: "x" } });
    falso.responder("mensagens_recebidas", ok([]));
    await expect(carregarAlertasWhatsapp(falso.cliente as never)).rejects.toThrow(
      "Falha ao carregar as mensagens com falha",
    );
  });

  it("erro do banco é lançado (o cartão mostra a falha)", async () => {
    falso.responder("whatsapp_status", { data: null, error: { message: "x" } });
    await expect(carregarAlertasWhatsapp(falso.cliente as never)).rejects.toThrow(
      "Falha ao carregar o estado do WhatsApp",
    );
  });
});

describe("carregarRespostas", () => {
  it("filtra pela classificação e ordena pelas mais recentes", async () => {
    falso.responder("mensagens_recebidas", ok([linhaResposta]));
    const r = await carregarRespostas(falso.cliente as never, { classificacao: "quer_remarcar" });
    expect(falso.chamadasDe("mensagens_recebidas", "eq")[0].args).toEqual(["classificacao", "quer_remarcar"]);
    expect(falso.chamadasDe("mensagens_recebidas", "order")[0].args).toEqual([
      "recebida_em",
      { ascending: false },
    ]);
    expect(r[0].clienteNome).toBe("Ana Souza");
  });
});
