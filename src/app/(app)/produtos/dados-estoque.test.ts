import { describe, expect, it, vi } from "vitest";
import { criarSupabaseFalso } from "@/test/supabase-falso";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => null }));

import { carregarEstoque, carregarMovimentos, LIMITE_MOVIMENTOS, periodoDoEstoque } from "./dados-estoque";

const ok = (data: unknown) => ({ data, error: null });
const A = "a0000000-0000-4000-8000-0000000000a1";
const B = "b0000000-0000-4000-8000-0000000000b2";
const C = "c0000000-0000-4000-8000-0000000000c3";
const D = "d0000000-0000-4000-8000-0000000000d4";

const produto = (id: string, nome: string, atual: number, minimo: number, ativo = true) => ({
  id,
  nome,
  unidade: "ml",
  estoque_atual: atual,
  estoque_minimo: minimo,
  ativo,
});

const movimento = (extra: Record<string, unknown> = {}) => ({
  id: "m1",
  produto_id: A,
  tipo: "entrada",
  quantidade: 1.5,
  custo_unitario_centavos: 1250,
  motivo: null,
  agendamento_id: null,
  criado_em: "2026-11-10T13:00:00+00:00",
  produtos: { nome: "Ácido", unidade: "ml" },
  colaboradores: { nome: "Fê" },
  agendamentos: null,
  ...extra,
});

const PERIODO = { de: "2026-11-01", ate: "2026-11-30" };

describe("carregarEstoque", () => {
  it("marca abaixo quando estoque ≤ mínimo em produto ativo; mais críticos primeiro", async () => {
    const falso = criarSupabaseFalso();
    falso.responder(
      "produtos",
      ok([
        produto(A, "Ácido", 5, 5),
        produto(B, "Bálsamo", 6, 5),
        produto(C, "Creme", 0, 5, false),
        produto(D, "Dermo", 1, 5),
      ]),
    );
    falso.responder("produtos_custos", ok([{ produto_id: A, custo_unitario_centavos: 1250 }]));
    falso.responder("movimentos_estoque", ok([]));

    const r = await carregarEstoque(falso.cliente as never, { produtoId: null, ...PERIODO });
    const porId = new Map(r.produtos.map((p) => [p.id, p]));
    expect(porId.get(A)).toEqual({
      id: A,
      nome: "Ácido",
      unidade: "ml",
      ativo: true,
      estoqueAtual: 5,
      estoqueMinimo: 5,
      custoCentavos: 1250,
      abaixo: true,
    });
    expect(porId.get(B)?.abaixo).toBe(false);
    expect(porId.get(C)?.abaixo).toBe(false);
    expect(porId.get(D)).toMatchObject({ abaixo: true, custoCentavos: 0 });
    expect(r.abaixo.map((p) => p.nome)).toEqual(["Dermo", "Ácido"]);
    // Ativos antes dos inativos.
    expect(r.produtos.map((p) => p.nome)).toEqual(["Ácido", "Bálsamo", "Dermo", "Creme"]);
  });

  it("numeric vindo como texto vira número", async () => {
    const falso = criarSupabaseFalso();
    falso.responder("produtos", ok([{ ...produto(A, "Ácido", 0, 0), estoque_atual: "2.500", estoque_minimo: "3" }]));
    falso.responder("produtos_custos", ok([]));
    falso.responder("movimentos_estoque", ok([]));
    const r = await carregarEstoque(falso.cliente as never, { produtoId: null, ...PERIODO });
    expect(r.produtos[0]).toMatchObject({ estoqueAtual: 2.5, estoqueMinimo: 3, abaixo: true });
  });

  it("histórico: período em São Paulo, mais recentes primeiro, limite 200, filtro de produto", async () => {
    const falso = criarSupabaseFalso();
    falso.responder("produtos", ok([produto(A, "Ácido", 5, 1)]));
    falso.responder("produtos_custos", ok([]));
    falso.responder(
      "movimentos_estoque",
      ok([
        movimento({
          id: "m2",
          tipo: "baixa_atendimento",
          quantidade: "-0.5",
          custo_unitario_centavos: null,
          agendamento_id: "ag1",
          // 05/11 01:30 UTC = 04/11 22:30 em SP.
          agendamentos: { inicio: "2026-11-05T01:30:00Z", clientes: { nome: "Maria" } },
          colaboradores: null,
        }),
        movimento({ id: "m1", tipo: "ajuste", quantidade: -2, custo_unitario_centavos: null, motivo: "Quebra" }),
      ]),
    );

    const r = await carregarEstoque(falso.cliente as never, { produtoId: A, ...PERIODO });
    const chamadas = falso.chamadasDe("movimentos_estoque").map((c) => [c.metodo, ...c.args]);
    // 01/11 00:00 em SP = 03:00 UTC; o fim é o dia seguinte a "até" (exclusivo).
    expect(chamadas).toContainEqual(["gte", "criado_em", "2026-11-01T03:00:00.000Z"]);
    expect(chamadas).toContainEqual(["lt", "criado_em", "2026-12-01T03:00:00.000Z"]);
    expect(chamadas).toContainEqual(["eq", "produto_id", A]);
    expect(chamadas).toContainEqual(["order", "criado_em", { ascending: false }]);
    expect(chamadas).toContainEqual(["limit", LIMITE_MOVIMENTOS]);
    expect(LIMITE_MOVIMENTOS).toBe(200);

    expect(r.movimentos).toEqual([
      {
        id: "m2",
        criadoEm: "2026-11-10T13:00:00+00:00",
        produtoId: A,
        produtoNome: "Ácido",
        unidade: "ml",
        tipo: "baixa_atendimento",
        quantidade: -0.5,
        custoCentavos: null,
        motivo: null,
        atendimento: { data: "2026-11-04", clienteNome: "Maria" },
        responsavelNome: null,
      },
      {
        id: "m1",
        criadoEm: "2026-11-10T13:00:00+00:00",
        produtoId: A,
        produtoNome: "Ácido",
        unidade: "ml",
        tipo: "ajuste",
        quantidade: -2,
        custoCentavos: null,
        motivo: "Quebra",
        atendimento: null,
        responsavelNome: "Fê",
      },
    ]);
    expect(r.limitado).toBe(false);
  });

  it("sem produto não filtra por produto; avisa quando bate o limite", async () => {
    const falso = criarSupabaseFalso();
    falso.responder("produtos", ok([]));
    falso.responder("produtos_custos", ok([]));
    falso.responder(
      "movimentos_estoque",
      ok(Array.from({ length: LIMITE_MOVIMENTOS }, (_, i) => movimento({ id: `m${i}` }))),
    );
    const r = await carregarEstoque(falso.cliente as never, { produtoId: null, ...PERIODO });
    const chamadas = falso.chamadasDe("movimentos_estoque");
    expect(chamadas.some((c) => c.metodo === "eq" && c.args[0] === "produto_id")).toBe(false);
    expect(r.limitado).toBe(true);
  });

  it("erro do banco vira exceção", async () => {
    const falso = criarSupabaseFalso();
    falso.responder("produtos", ok([]));
    falso.responder("produtos_custos", ok([]));
    falso.responder("movimentos_estoque", { data: null, error: { message: "permission denied" } });
    await expect(carregarEstoque(falso.cliente as never, { produtoId: null, ...PERIODO })).rejects.toThrow(
      "permission denied",
    );
  });
});

describe("carregarMovimentos", () => {
  it("sem período não filtra por data", async () => {
    const falso = criarSupabaseFalso();
    falso.responder("movimentos_estoque", ok([]));
    await carregarMovimentos(falso.cliente as never, { produtoId: A });
    const chamadas = falso.chamadasDe("movimentos_estoque");
    expect(chamadas.some((c) => c.metodo === "gte" || c.metodo === "lt")).toBe(false);
    expect(chamadas.map((c) => [c.metodo, ...c.args])).toContainEqual(["eq", "produto_id", A]);
  });
});

describe("periodoDoEstoque", () => {
  const agora = new Date("2026-11-11T15:00:00Z");
  it("padrão: últimos 30 dias até hoje (SP)", () => {
    expect(periodoDoEstoque({}, agora)).toEqual({ de: "2026-10-13", ate: "2026-11-11" });
  });
  it("aceita de/até válidos e recusa invertidos ou inválidos", () => {
    expect(periodoDoEstoque({ de: "2026-01-01", ate: "2026-01-31" }, agora)).toEqual({
      de: "2026-01-01",
      ate: "2026-01-31",
    });
    expect(periodoDoEstoque({ de: "2026-02-01", ate: "2026-01-31" }, agora)).toEqual({
      de: "2026-10-13",
      ate: "2026-11-11",
    });
    expect(periodoDoEstoque({ de: "2026-02-30", ate: "2026-03-01" }, agora).de).toBe("2026-10-13");
  });
});
