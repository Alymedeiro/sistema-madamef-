import { describe, expect, it, vi } from "vitest";
import { criarSupabaseFalso } from "@/test/supabase-falso";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => null }));

import { aniversariantesDaSemana, atendidosSemPagamento } from "./dados";

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
