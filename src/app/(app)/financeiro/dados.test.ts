import { describe, expect, it, vi } from "vitest";
import { criarSupabaseFalso } from "@/test/supabase-falso";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => null }));

import { carregarProximosVencimentos, carregarResumo, fimDoMesSeguinte } from "./dados";

const ok = (data: unknown) => ({ data, error: null });

const LINHA = {
  recebido: 180000,
  recebido_qtd: 4,
  pago: "80000",
  pago_qtd: "2",
  a_receber: 15000,
  ja_recebido: 5000,
  a_pagar: 350000,
  ja_pago: 0,
  vencidos_qtd: 1,
  vencidos_total: "12000",
};

describe("fimDoMesSeguinte", () => {
  it("último dia do mês seguinte, com virada de ano e fevereiro", () => {
    expect(fimDoMesSeguinte("2026-11-10")).toBe("2026-12-31");
    expect(fimDoMesSeguinte("2026-12-15")).toBe("2027-01-31");
    expect(fimDoMesSeguinte("2027-01-31")).toBe("2027-02-28");
    expect(fimDoMesSeguinte("2028-01-01")).toBe("2028-02-29");
  });
});

describe("carregarResumo", () => {
  // 10/11/2026 12:00 em São Paulo.
  const agora = new Date("2026-11-10T15:00:00Z");

  it("gera as contas fixas até o fim do mês seguinte ANTES do resumo do período", async () => {
    const falso = criarSupabaseFalso();
    falso.responder("rpc:gerar_contas_fixas", ok(2));
    falso.responder("rpc:resumo_financeiro", ok([LINHA]));
    await carregarResumo(falso.cliente as never, "2026-11-01", "2026-11-30", agora);

    const ordem = falso.chamadas.map((c) => c.tabela);
    expect(ordem).toEqual(["rpc:gerar_contas_fixas", "rpc:resumo_financeiro"]);
    expect(falso.chamadasRpc("gerar_contas_fixas")[0].args[0]).toEqual({ p_ate: "2026-12-31" });
    expect(falso.chamadasRpc("resumo_financeiro")[0].args[0]).toEqual({
      p_de: "2026-11-01",
      p_ate: "2026-11-30",
    });
  });

  it("mapeia snake_case → camelCase e normaliza bigint em texto para número", async () => {
    const falso = criarSupabaseFalso();
    falso.responder("rpc:gerar_contas_fixas", ok(0));
    falso.responder("rpc:resumo_financeiro", ok([LINHA]));
    const r = await carregarResumo(falso.cliente as never, "2026-11-01", "2026-11-30", agora);
    expect(r).toEqual({
      recebido: 180000,
      recebidoQtd: 4,
      pago: 80000,
      pagoQtd: 2,
      aReceber: 15000,
      jaRecebido: 5000,
      aPagar: 350000,
      jaPago: 0,
      vencidosQtd: 1,
      vencidosTotal: 12000,
    });
  });

  it("aceita a linha como objeto (não array) e sem linha devolve zeros", async () => {
    const falso = criarSupabaseFalso();
    falso.responder("rpc:gerar_contas_fixas", ok(0), ok(0));
    falso.responder("rpc:resumo_financeiro", ok(LINHA), ok([]));
    const um = await carregarResumo(falso.cliente as never, "2026-11-01", "2026-11-30", agora);
    expect(um.vencidosTotal).toBe(12000);
    const vazio = await carregarResumo(falso.cliente as never, "2026-11-01", "2026-11-30", agora);
    expect(Object.values(vazio).every((v) => v === 0)).toBe(true);
  });

  it("erro em gerar_contas_fixas interrompe sem consultar o resumo", async () => {
    const falso = criarSupabaseFalso();
    falso.responder("rpc:gerar_contas_fixas", { data: null, error: { message: "Acesso não autorizado" } });
    await expect(
      carregarResumo(falso.cliente as never, "2026-11-01", "2026-11-30", agora),
    ).rejects.toThrow(/Acesso não autorizado/);
    expect(falso.chamadasRpc("resumo_financeiro")).toHaveLength(0);
  });

  it("erro do resumo é lançado", async () => {
    const falso = criarSupabaseFalso();
    falso.responder("rpc:gerar_contas_fixas", ok(0));
    falso.responder("rpc:resumo_financeiro", { data: null, error: { message: "boom" } });
    await expect(
      carregarResumo(falso.cliente as never, "2026-11-01", "2026-11-30", agora),
    ).rejects.toThrow(/boom/);
  });
});

describe("carregarProximosVencimentos", () => {
  it("lê pagar (aberta) e receber (em aberto, não cancelada) de hoje a hoje+7, em ordem", async () => {
    const falso = criarSupabaseFalso();
    falso.responder(
      "contas_pagar",
      ok([{ id: "p1", descricao: "Aluguel", valor_centavos: 350000, vencimento: "2026-11-13" }]),
    );
    falso.responder(
      "contas_receber",
      ok([
        {
          id: "r1",
          descricao: null,
          valor_centavos: 15000,
          vencimento: "2026-11-10",
          numero: 2,
          total_parcelas: 3,
          clientes: { nome: "Maria Silva" },
        },
      ]),
    );
    const r = await carregarProximosVencimentos(falso.cliente as never, "2026-11-10");

    const pagar = falso.chamadasDe("contas_pagar");
    expect(pagar).toContainEqual({ tabela: "contas_pagar", metodo: "eq", args: ["status", "aberta"] });
    expect(pagar).toContainEqual({ tabela: "contas_pagar", metodo: "gte", args: ["vencimento", "2026-11-10"] });
    expect(pagar).toContainEqual({ tabela: "contas_pagar", metodo: "lte", args: ["vencimento", "2026-11-17"] });

    const receber = falso.chamadasDe("contas_receber");
    const select = receber.find((c) => c.metodo === "select")!.args[0] as string;
    expect(select).toContain("clientes(nome)");
    expect(receber).toContainEqual({ tabela: "contas_receber", metodo: "is", args: ["recebido_em", null] });
    expect(receber).toContainEqual({ tabela: "contas_receber", metodo: "is", args: ["cancelada_em", null] });
    expect(receber).toContainEqual({ tabela: "contas_receber", metodo: "gte", args: ["vencimento", "2026-11-10"] });
    expect(receber).toContainEqual({ tabela: "contas_receber", metodo: "lte", args: ["vencimento", "2026-11-17"] });

    expect(r).toEqual([
      {
        tipo: "receber",
        id: "r1",
        nome: "Maria Silva",
        detalhe: "parcela 2/3",
        valorCentavos: 15000,
        vencimento: "2026-11-10",
      },
      {
        tipo: "pagar",
        id: "p1",
        nome: "Aluguel",
        detalhe: null,
        valorCentavos: 350000,
        vencimento: "2026-11-13",
      },
    ]);
  });

  it("conta a receber manual mostra a descrição; erro do banco é lançado", async () => {
    const falso = criarSupabaseFalso();
    falso.responder("contas_pagar", ok([]));
    falso.responder(
      "contas_receber",
      ok([
        {
          id: "r2",
          descricao: "Acerto",
          valor_centavos: 9000,
          vencimento: "2026-11-11",
          numero: 1,
          total_parcelas: 1,
          clientes: null,
        },
      ]),
    );
    const r = await carregarProximosVencimentos(falso.cliente as never, "2026-11-10");
    expect(r[0]).toMatchObject({ nome: "—", detalhe: "Acerto" });

    const erro = criarSupabaseFalso();
    erro.responder("contas_pagar", { data: null, error: { message: "x" } });
    erro.responder("contas_receber", ok([]));
    await expect(carregarProximosVencimentos(erro.cliente as never, "2026-11-10")).rejects.toThrow();
  });
});
