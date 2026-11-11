import { describe, expect, it, vi } from "vitest";
import { criarSupabaseFalso } from "@/test/supabase-falso";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => null }));

import { carregarFluxo } from "./dados-fluxo";
import { listarContasReceber, listarParcelasAReceber, listarRecebimentosDosCaixas } from "./dados-receber";

const ok = (data: unknown) => ({ data, error: null });
const HOJE = "2026-11-10";
const PERIODO = { de: "2026-11-01", ate: "2026-11-30" };

const linha = (extra: Record<string, unknown> = {}) => ({
  id: "r1",
  cliente_id: "cl1",
  descricao: null,
  numero: 2,
  total_parcelas: 3,
  valor_centavos: 15000,
  vencimento: "2026-11-05",
  recebido_em: null,
  cancelada_em: null,
  origem_manual: false,
  clientes: { nome: "Maria Silva" },
  pagamento: { origem: "pacote" },
  ...extra,
});

function filtros(falso: ReturnType<typeof criarSupabaseFalso>) {
  return falso.chamadasDe("contas_receber").map((c) => [c.metodo, ...c.args]);
}

describe("listarContasReceber", () => {
  it("em aberto (padrão): sem recebimento nem cancelamento, de max(de, hoje) até ate", async () => {
    const falso = criarSupabaseFalso();
    falso.responder("contas_receber", ok([linha({ vencimento: "2026-11-12" })]));
    const r = await listarContasReceber(falso.cliente as never, { ...PERIODO }, HOJE);
    const f = filtros(falso);
    expect(f).toContainEqual(["is", "recebido_em", null]);
    expect(f).toContainEqual(["is", "cancelada_em", null]);
    expect(f).toContainEqual(["gte", "vencimento", HOJE]);
    expect(f).toContainEqual(["lte", "vencimento", "2026-11-30"]);
    expect(r[0]).toMatchObject({
      id: "r1",
      clienteNome: "Maria Silva",
      origem: "pacote",
      parcela: "2/3",
      valorCentavos: 15000,
      situacao: "em_aberto",
      recebidoEm: null,
      aberta: true,
    });
  });

  it("vencidas ignoram o período", async () => {
    const falso = criarSupabaseFalso();
    falso.responder("contas_receber", ok([linha()]));
    const r = await listarContasReceber(falso.cliente as never, { ...PERIODO, situacao: "vencida" }, HOJE);
    const f = filtros(falso);
    expect(f).toContainEqual(["lt", "vencimento", HOJE]);
    expect(f.some(([m, c]) => m === "gte" && c === "vencimento")).toBe(false);
    expect(r[0].situacao).toBe("vencida");
  });

  it("recebidas filtram por recebido_em no dia de São Paulo; mostra a data em SP", async () => {
    const falso = criarSupabaseFalso();
    // 01:30 UTC do dia 11 = 22:30 do dia 10 em SP.
    falso.responder("contas_receber", ok([linha({ recebido_em: "2026-11-11T01:30:00Z" })]));
    const r = await listarContasReceber(falso.cliente as never, { ...PERIODO, situacao: "paga" }, HOJE);
    const f = filtros(falso);
    expect(f).toContainEqual(["not", "recebido_em", "is", null]);
    expect(f).toContainEqual(["gte", "recebido_em", "2026-11-01T03:00:00.000Z"]);
    expect(f).toContainEqual(["lt", "recebido_em", "2026-12-01T03:00:00.000Z"]);
    expect(r[0]).toMatchObject({ situacao: "paga", recebidoEm: "2026-11-10", aberta: false });
  });

  it("canceladas e manuais", async () => {
    const falso = criarSupabaseFalso();
    falso.responder(
      "contas_receber",
      ok([
        linha({
          cancelada_em: "2026-11-02T12:00:00Z",
          origem_manual: true,
          pagamento: null,
          descricao: "Venda avulsa",
          numero: 1,
          total_parcelas: 1,
        }),
      ]),
    );
    const r = await listarContasReceber(falso.cliente as never, { ...PERIODO, situacao: "cancelada" }, HOJE);
    expect(filtros(falso)).toContainEqual(["not", "cancelada_em", "is", null]);
    expect(r[0]).toMatchObject({ situacao: "cancelada", origem: "manual", descricao: "Venda avulsa", aberta: false });
  });

  it("busca por nome da cliente ou descrição", async () => {
    const falso = criarSupabaseFalso();
    falso.responder("clientes", ok([{ id: "cl1" }, { id: "cl2" }]));
    falso.responder("contas_receber", ok([]));
    await listarContasReceber(falso.cliente as never, { ...PERIODO, busca: "Maria, (x)" }, HOJE);
    expect(falso.chamadasDe("clientes")).toContainEqual({
      tabela: "clientes",
      metodo: "ilike",
      args: ["nome", "%Maria x%"],
    });
    expect(filtros(falso)).toContainEqual(["or", "descricao.ilike.%Maria x%,cliente_id.in.(cl1,cl2)"]);
  });

  it("em aberto num período passado não consulta", async () => {
    const falso = criarSupabaseFalso();
    const r = await listarContasReceber(
      falso.cliente as never,
      { de: "2026-10-01", ate: "2026-10-31" },
      HOJE,
    );
    expect(r).toEqual([]);
    expect(falso.chamadas).toHaveLength(0);
  });
});

describe("listarParcelasAReceber", () => {
  it("em aberto com vencimento até hoje, das mais antigas", async () => {
    const falso = criarSupabaseFalso();
    falso.responder("contas_receber", ok([linha({ vencimento: "2026-11-10" })]));
    const r = await listarParcelasAReceber(falso.cliente as never, HOJE);
    const f = filtros(falso);
    expect(f).toContainEqual(["is", "recebido_em", null]);
    expect(f).toContainEqual(["is", "cancelada_em", null]);
    expect(f).toContainEqual(["lte", "vencimento", HOJE]);
    expect(f).toContainEqual(["order", "vencimento"]);
    expect(r[0]).toMatchObject({ id: "r1", clienteNome: "Maria Silva", situacao: "em_aberto", parcela: "2/3" });
  });
});

describe("listarRecebimentosDosCaixas", () => {
  it("sem caixas não consulta; com caixas devolve forma e valor", async () => {
    const vazio = criarSupabaseFalso();
    expect(await listarRecebimentosDosCaixas(vazio.cliente as never, [])).toEqual([]);
    expect(vazio.chamadas).toHaveLength(0);

    const falso = criarSupabaseFalso();
    falso.responder(
      "recebimentos",
      ok([
        {
          id: "x1",
          caixa_id: "k1",
          forma: "dinheiro",
          valor_centavos: 5000,
          recebido_em: "2026-11-10T13:05:00Z",
          contas_receber: { numero: 1, total_parcelas: 2, descricao: null, clientes: { nome: "Ana" } },
        },
      ]),
    );
    const r = await listarRecebimentosDosCaixas(falso.cliente as never, ["k1"]);
    expect(falso.chamadasDe("recebimentos")).toContainEqual({
      tabela: "recebimentos",
      metodo: "in",
      args: ["caixa_id", ["k1"]],
    });
    expect(r).toEqual([
      {
        id: "x1",
        caixaId: "k1",
        forma: "dinheiro",
        valorCentavos: 5000,
        hora: "10:05",
        clienteNome: "Ana",
        parcela: "1/2",
      },
    ]);
  });
});

describe("carregarFluxo", () => {
  it("calcula saldo e acumulado; normaliza bigint em texto", async () => {
    const falso = criarSupabaseFalso();
    falso.responder(
      "rpc:fluxo_caixa",
      ok([
        { periodo: "2026-11-05", entradas: "18000", saidas: 0 },
        { periodo: "2026-11-10", entradas: 0, saidas: "8000" },
      ]),
    );
    falso.responder("rpc:fluxo_por_forma", ok([{ forma: "pix", total: "18000" }]));
    falso.responder("rpc:despesas_por_categoria", ok([{ categoria: "aluguel", total: "8000" }]));
    const r = await carregarFluxo(falso.cliente as never, "2026-11-01", "2026-11-30");
    expect(falso.chamadasRpc("fluxo_caixa")[0].args[0]).toEqual({
      p_de: "2026-11-01",
      p_ate: "2026-11-30",
      p_agrupar: "dia",
    });
    expect(r.agrupar).toBe("dia");
    expect(r.linhas).toEqual([
      { periodo: "2026-11-05", entradas: 18000, saidas: 0, saldo: 18000, acumulado: 18000 },
      { periodo: "2026-11-10", entradas: 0, saidas: 8000, saldo: -8000, acumulado: 10000 },
    ]);
    expect(r.totais).toEqual({ entradas: 18000, saidas: 8000, saldo: 10000 });
    expect(r.porForma).toEqual([{ forma: "pix", total: 18000 }]);
    expect(r.porCategoria).toEqual([{ categoria: "aluguel", total: 8000 }]);
  });

  it("período maior que 62 dias agrupa por mês", async () => {
    const falso = criarSupabaseFalso();
    falso.definirPadrao(ok([]));
    const r = await carregarFluxo(falso.cliente as never, "2026-01-01", "2026-12-31");
    expect(falso.chamadasRpc("fluxo_caixa")[0].args[0]).toMatchObject({ p_agrupar: "mes" });
    expect(r.agrupar).toBe("mes");
    expect(r.linhas).toEqual([]);
  });

  it("erro do banco vira exceção", async () => {
    const falso = criarSupabaseFalso();
    falso.responder("rpc:fluxo_caixa", { data: null, error: { message: "boom" } });
    await expect(carregarFluxo(falso.cliente as never, "2026-11-01", "2026-11-30")).rejects.toThrow(
      /fluxo/,
    );
  });
});
