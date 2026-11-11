import { beforeEach, describe, expect, it, vi } from "vitest";
import { criarSupabaseFalso } from "@/test/supabase-falso";

vi.mock("server-only", () => ({}));

import {
  carregarAlertasWhatsapp,
  carregarFila,
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

  it("conectado não acusa; falhas dos últimos 7 dias; respostas não lidas que pedem atenção", async () => {
    falso.responder("configuracoes_clinica", ok({ whatsapp_ativo: true }));
    falso.responder("whatsapp_status", ok({ estado: "conectado" }));
    const r = await carregarAlertasWhatsapp(falso.cliente as never, new Date("2026-11-11T12:00:00Z"));
    expect(r.desconectado).toBe(false);
    expect(falso.chamadasDe("fila_mensagens", "in")[0].args).toEqual([
      "status",
      ["falhou", "pendente", "enviando", "enviada"],
    ]);
    expect(falso.chamadasDe("fila_mensagens", "gte")[0].args).toEqual([
      "atualizado_em",
      "2026-11-04T12:00:00.000Z",
    ]);
    expect(falso.chamadasDe("mensagens_recebidas", "is")[0].args).toEqual(["lida_em", null]);
    expect(falso.chamadasDe("mensagens_recebidas", "in")[0].args).toEqual([
      "classificacao",
      ["quer_remarcar", "para_ler"],
    ]);
  });

  it("erro do banco é lançado (o cartão mostra a falha)", async () => {
    falso.responder("whatsapp_status", { data: null, error: { message: "x" } });
    await expect(carregarAlertasWhatsapp(falso.cliente as never)).rejects.toThrow(
      "Falha ao carregar o estado do WhatsApp",
    );
  });
});

describe("carregarFila", () => {
  const linha = {
    id: "f1",
    tipo: "avulsa",
    status: "pendente",
    telefone: "5511987654321",
    texto: "Oi",
    agendado_para: "2026-11-11T12:00:00Z",
    enviada_em: null,
    criado_em: "2026-11-11T12:00:00Z",
    tentativas: 0,
    erro: null,
    cancelada_motivo: null,
    cliente_id: "c1",
    agendamento_id: null,
    clientes: { nome: "Ana" },
  };

  it("200 mais recentes, com filtros de status e tipo", async () => {
    falso.responder("fila_mensagens", ok([linha]));
    const r = await carregarFila(falso.cliente as never, { status: "pendente", tipo: "avulsa" });
    expect(falso.chamadasDe("fila_mensagens", "eq").map((c) => c.args)).toEqual([
      ["status", "pendente"],
      ["tipo", "avulsa"],
    ]);
    expect(falso.chamadasDe("fila_mensagens", "order")[0].args).toEqual(["criado_em", { ascending: false }]);
    expect(falso.chamadasDe("fila_mensagens", "limit")[0].args).toEqual([200]);
    expect(r[0]).toMatchObject({ id: "f1", clienteNome: "Ana", agendadoPara: "2026-11-11T12:00:00Z" });
  });

  it("busca por nome filtra pelas clientes encontradas; sem nenhuma, nem consulta a fila", async () => {
    falso.responder("clientes", ok([{ id: "c1" }, { id: "c2" }]));
    falso.responder("fila_mensagens", ok([]));
    await carregarFila(falso.cliente as never, { busca: "Ána" });
    expect(falso.chamadasDe("clientes", "ilike")[0].args).toEqual(["nome_busca", "%ana%"]);
    expect(falso.chamadasDe("fila_mensagens", "in")[0].args).toEqual(["cliente_id", ["c1", "c2"]]);

    falso = criarSupabaseFalso();
    falso.responder("clientes", ok([]));
    expect(await carregarFila(falso.cliente as never, { busca: "Zelda" })).toEqual([]);
    expect(falso.chamadasDe("fila_mensagens")).toHaveLength(0);
  });

  it("busca por número filtra o telefone (com e sem 55)", async () => {
    falso.responder("fila_mensagens", ok([]));
    await carregarFila(falso.cliente as never, { busca: "5511987654321" });
    expect(falso.chamadasDe("fila_mensagens", "or")[0].args).toEqual([
      "telefone.like.*5511987654321*,telefone.like.*11987654321*",
    ]);
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
