import { describe, expect, it, vi } from "vitest";
import { criarSupabaseFalso } from "@/test/supabase-falso";

vi.mock("server-only", () => ({}));

import { clientesPorTelefone, listarPedidos } from "./dados";

const ok = (data: unknown) => ({ data, error: null });

const LINHA = {
  id: "p1",
  nome: "Maria Souza",
  whatsapp: "5511987654321",
  servico_id: "s1",
  profissional_id: "c1",
  inicio: "2026-11-10T12:00:00+00:00",
  fim: "2026-11-10T13:00:00+00:00",
  avaliacao: true,
  status: "aguardando",
  criado_em: "2026-11-08T10:30:00+00:00",
  agendamento_id: null,
  motivo_recusa: null,
  servicos: { nome: "Limpeza de pele" },
  colaboradores: { nome: "Fernanda" },
};

describe("listarPedidos", () => {
  it("expira os vencidos antes de ler e calcula expiraEm = criadoEm + 24h", async () => {
    const falso = criarSupabaseFalso();
    falso.responder("rpc:expirar_pedidos_online", ok(0));
    falso.responder("pedidos_online", ok([LINHA]));

    const r = await listarPedidos(falso.cliente as never, "aguardando");

    const ordem = falso.chamadas.map((c) => c.tabela);
    expect(ordem[0]).toBe("rpc:expirar_pedidos_online");
    expect(ordem.indexOf("pedidos_online")).toBeGreaterThan(0);
    expect(falso.chamadasDe("pedidos_online", "eq")[0].args).toEqual(["status", "aguardando"]);
    // Aguardando: mais antigo primeiro.
    expect(falso.chamadasDe("pedidos_online", "order")[0].args).toEqual([
      "criado_em",
      { ascending: true },
    ]);
    const select = falso.chamadasDe("pedidos_online", "select")[0].args[0] as string;
    expect(select).toContain("colaboradores!pedidos_online_profissional_id_fkey(nome)");

    expect(r).toEqual([
      {
        id: "p1",
        nome: "Maria Souza",
        whatsapp: "5511987654321",
        servicoId: "s1",
        servicoNome: "Limpeza de pele",
        profissionalId: "c1",
        profissionalNome: "Fernanda",
        inicio: "2026-11-10T12:00:00+00:00",
        fim: "2026-11-10T13:00:00+00:00",
        avaliacao: true,
        status: "aguardando",
        criadoEm: "2026-11-08T10:30:00+00:00",
        expiraEm: "2026-11-09T10:30:00.000Z",
        agendamentoId: null,
        motivoRecusa: null,
      },
    ]);
  });

  it("respondidos vêm do mais recente para o mais antigo", async () => {
    const falso = criarSupabaseFalso();
    falso.responder("rpc:expirar_pedidos_online", ok(0));
    falso.responder("pedidos_online", ok([]));
    await listarPedidos(falso.cliente as never, "recusado");
    expect(falso.chamadasDe("pedidos_online", "order")[0].args).toEqual([
      "criado_em",
      { ascending: false },
    ]);
  });

  it("erro ao expirar ou ao ler é lançado", async () => {
    const falso = criarSupabaseFalso();
    falso.responder("rpc:expirar_pedidos_online", { data: null, error: { message: "x" } });
    await expect(listarPedidos(falso.cliente as never, "aguardando")).rejects.toThrow(
      "Falha ao carregar os pedidos online",
    );
    expect(falso.chamadasDe("pedidos_online")).toHaveLength(0);

    const falso2 = criarSupabaseFalso();
    falso2.responder("rpc:expirar_pedidos_online", ok(0));
    falso2.responder("pedidos_online", { data: null, error: { message: "y" } });
    await expect(listarPedidos(falso2.cliente as never, "aguardando")).rejects.toThrow(
      "Falha ao carregar os pedidos online",
    );
  });
});

describe("clientesPorTelefone", () => {
  it("busca pelo número normalizado", async () => {
    const falso = criarSupabaseFalso();
    falso.responder("clientes", ok([{ id: "k1", nome: "Maria Souza" }]));
    const r = await clientesPorTelefone(falso.cliente as never, "(11) 9 8765-4321");
    expect(falso.chamadasDe("clientes", "eq")[0].args).toEqual(["whatsapp", "5511987654321"]);
    expect(r).toEqual([{ id: "k1", nome: "Maria Souza" }]);
  });

  it("número inválido não consulta o banco", async () => {
    const falso = criarSupabaseFalso();
    expect(await clientesPorTelefone(falso.cliente as never, "98765-4321")).toEqual([]);
    expect(falso.chamadas).toHaveLength(0);
  });
});
