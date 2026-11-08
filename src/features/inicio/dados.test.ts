import { describe, expect, it, vi } from "vitest";
import { criarSupabaseFalso } from "@/test/supabase-falso";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => null }));

import {
  aniversariantesDaSemana,
  atendidosSemPagamento,
  atendidosSemTermo,
  pedidosAguardando,
} from "./dados";

const ok = (data: unknown) => ({ data, error: null });

describe("aniversariantesDaSemana", () => {
  it("filtra no banco (aniversariantes_entre) e ordena pelos dias até o aniversário", async () => {
    const falso = criarSupabaseFalso();
    falso.responder(
      "rpc:aniversariantes_entre",
      ok([
        { id: "b", nome: "Bia", data_nascimento: "1985-01-02", whatsapp: null, dias: 4 },
        { id: "a", nome: "Ana", data_nascimento: "1990-12-30", whatsapp: "5511987654321", dias: 1 },
      ]),
    );
    const r = await aniversariantesDaSemana(falso.cliente as never, "2030-12-29", "2031-01-04");
    expect(falso.chamadasRpc("aniversariantes_entre")[0].args[0]).toEqual({
      p_de: "2030-12-29",
      p_ate: "2031-01-04",
    });
    expect(falso.chamadasDe("clientes")).toHaveLength(0);
    expect(r).toEqual([
      { id: "a", nome: "Ana", dataNascimento: "1990-12-30", whatsapp: "5511987654321" },
      { id: "b", nome: "Bia", dataNascimento: "1985-01-02", whatsapp: null },
    ]);
  });

  it("erro do banco é lançado (o cartão mostra a falha)", async () => {
    const falso = criarSupabaseFalso();
    falso.responder("rpc:aniversariantes_entre", { data: null, error: { message: "x" } });
    await expect(
      aniversariantesDaSemana(falso.cliente as never, "2030-12-29", "2031-01-04"),
    ).rejects.toThrow("Falha ao carregar os aniversariantes");
  });
});

describe("atendidosSemPagamento", () => {
  it("consulta os últimos 7 dias e devolve com o dia de cada atendimento", async () => {
    const falso = criarSupabaseFalso();
    falso.responder("rpc:agendamentos_sem_pagamento_periodo", ok(["a1", "a2"]));
    falso.responder(
      "agendamentos",
      ok([
        {
          id: "a1",
          inicio: "2026-10-29T02:30:00Z", // 28/10 23:30 em São Paulo
          cliente_id: "c1",
          valor_previsto_centavos: 18000,
          clientes: { nome: "Maria" },
          servicos: { nome: "Limpeza" },
        },
        {
          id: "a2",
          inicio: "2026-11-03T13:00:00Z",
          cliente_id: "c2",
          valor_previsto_centavos: 5000,
          clientes: null,
          servicos: null,
        },
      ]),
    );
    const r = await atendidosSemPagamento(falso.cliente as never, "2026-10-28", "2026-11-03");
    expect(falso.chamadasRpc("agendamentos_sem_pagamento_periodo")[0].args[0]).toEqual({
      p_de: "2026-10-28",
      p_ate: "2026-11-03",
    });
    expect(r).toEqual([
      {
        id: "a1",
        inicio: "2026-10-29T02:30:00Z",
        dia: "2026-10-28",
        clienteId: "c1",
        clienteNome: "Maria",
        servicoNome: "Limpeza",
        valorPrevistoCentavos: 18000,
      },
      {
        id: "a2",
        inicio: "2026-11-03T13:00:00Z",
        dia: "2026-11-03",
        clienteId: "c2",
        clienteNome: "—",
        servicoNome: "—",
        valorPrevistoCentavos: 5000,
      },
    ]);
  });

  it("sem pendências: não consulta agendamentos", async () => {
    const falso = criarSupabaseFalso();
    falso.responder("rpc:agendamentos_sem_pagamento_periodo", ok([]));
    expect(await atendidosSemPagamento(falso.cliente as never, "2026-10-28", "2026-11-03")).toEqual([]);
    expect(falso.chamadasDe("agendamentos")).toHaveLength(0);
  });
});

describe("atendidosSemTermo", () => {
  it("consulta o período, devolve o atendimento com a cliente e pula a segunda consulta se vazio", async () => {
    const falso = criarSupabaseFalso();
    falso.responder("rpc:atendimentos_sem_termo", ok(["a1"]));
    falso.responder(
      "agendamentos",
      ok([
        {
          id: "a1",
          inicio: "2026-11-03T15:00:00+00:00",
          cliente_id: "c1",
          clientes: { nome: "Ana" },
          servicos: { nome: "Peeling" },
        },
      ]),
    );
    const r = await atendidosSemTermo(falso.cliente as never, "2026-10-06", "2026-11-04");
    expect(falso.chamadasRpc("atendimentos_sem_termo")[0].args[0]).toEqual({
      p_de: "2026-10-06",
      p_ate: "2026-11-04",
    });
    expect(r).toEqual([
      { id: "a1", inicio: "2026-11-03T15:00:00+00:00", clienteId: "c1", clienteNome: "Ana", servicoNome: "Peeling" },
    ]);

    const vazio = criarSupabaseFalso();
    vazio.responder("rpc:atendimentos_sem_termo", ok([]));
    expect(await atendidosSemTermo(vazio.cliente as never, "2026-10-06", "2026-11-04")).toEqual([]);
    expect(vazio.chamadasDe("agendamentos")).toHaveLength(0);
  });

  it("erro do banco é lançado", async () => {
    const falso = criarSupabaseFalso();
    falso.responder("rpc:atendimentos_sem_termo", { data: null, error: { message: "x" } });
    await expect(atendidosSemTermo(falso.cliente as never, "a", "b")).rejects.toThrow(
      "Falha ao carregar os atendimentos sem termo",
    );
  });
});

describe("pedidosAguardando", () => {
  it("expira os vencidos e devolve os aguardando, mais antigo primeiro, com o prazo", async () => {
    const falso = criarSupabaseFalso();
    falso.responder("rpc:expirar_pedidos_online", ok(1));
    falso.responder(
      "pedidos_online",
      ok([
        {
          id: "p1",
          nome: "Maria Souza",
          whatsapp: "5511987654321",
          servico_id: "s1",
          profissional_id: "c1",
          inicio: "2026-11-10T12:00:00+00:00",
          fim: "2026-11-10T13:00:00+00:00",
          avaliacao: false,
          status: "aguardando",
          criado_em: "2026-11-08T10:30:00+00:00",
          agendamento_id: null,
          motivo_recusa: null,
          servicos: { nome: "Limpeza" },
          colaboradores: { nome: "Fernanda" },
        },
      ]),
    );
    const r = await pedidosAguardando(falso.cliente as never);
    expect(falso.chamadasRpc("expirar_pedidos_online")).toHaveLength(1);
    expect(r).toEqual([
      {
        id: "p1",
        nome: "Maria Souza",
        servicoNome: "Limpeza",
        inicio: "2026-11-10T12:00:00+00:00",
        expiraEm: "2026-11-09T10:30:00.000Z",
      },
    ]);
  });
});
