import { describe, expect, it, vi } from "vitest";
import { criarSupabaseFalso } from "@/test/supabase-falso";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => null }));

import { carregarComissoes } from "./dados-comissoes";

const ok = (data: unknown) => ({ data, error: null });
const ANA = "a0000000-0000-4000-8000-0000000000a1";
const BIA = "b0000000-0000-4000-8000-0000000000b2";
const PERIODO = { de: "2026-11-01", ate: "2026-11-30" };

const resumo = [
  { profissional_id: ANA, nome: "Ana", competencia: "2026-11-01", qtd: 3, base: 30000, aberto: 8000, pago: 4000 },
  { profissional_id: BIA, nome: "Bia", competencia: "2026-11-01", qtd: 1, base: 10000, aberto: 0, pago: 3000 },
];
const comissao = (extra: Record<string, unknown> = {}) => ({
  id: "k1",
  profissional_id: ANA,
  competencia: "2026-11-01",
  base_centavos: 10000,
  percentual: 40,
  valor_centavos: 4000,
  status: "aberta",
  pago_em: null,
  // 05/11 01:30 UTC = 04/11 22:30 em São Paulo.
  agendamentos: { inicio: "2026-11-05T01:30:00Z", clientes: { nome: "Maria" } },
  servicos: { nome: "Limpeza de pele" },
  colaboradores: { nome: "Ana" },
  ...extra,
});

describe("carregarComissoes", () => {
  it("monta resumo e linhas; filtro padrão Em aberto e competência do período", async () => {
    const falso = criarSupabaseFalso();
    falso.responder("rpc:resumo_comissoes", ok(resumo));
    falso.responder(
      "comissoes",
      ok([
        comissao({ id: "k2", agendamentos: { inicio: "2026-11-20T13:00:00Z", clientes: { nome: "Joana" } } }),
        comissao(),
      ]),
    );
    const r = await carregarComissoes(falso.cliente as never, {
      ...PERIODO,
      situacao: "aberta",
      profissionalId: null,
    });

    expect(falso.chamadasRpc("resumo_comissoes")[0].args[0]).toEqual({ p_de: "2026-11-01", p_ate: "2026-11-30" });
    const f = falso.chamadasDe("comissoes").map((c) => [c.metodo, ...c.args]);
    expect(f).toContainEqual(["eq", "status", "aberta"]);
    expect(f).toContainEqual(["gte", "competencia", "2026-11-01"]);
    expect(f).toContainEqual(["lte", "competencia", "2026-11-30"]);
    expect(f.some(([m, col]) => m === "eq" && col === "profissional_id")).toBe(false);

    expect(r.resumo).toEqual([
      { profissionalId: ANA, nome: "Ana", competencia: "2026-11-01", qtd: 3, baseCentavos: 30000, abertoCentavos: 8000, pagoCentavos: 4000 },
      { profissionalId: BIA, nome: "Bia", competencia: "2026-11-01", qtd: 1, baseCentavos: 10000, abertoCentavos: 0, pagoCentavos: 3000 },
    ]);
    expect(r.linhas.map((l) => l.id)).toEqual(["k1", "k2"]);
    expect(r.linhas[0]).toEqual({
      id: "k1",
      data: "2026-11-04",
      clienteNome: "Maria",
      servicoNome: "Limpeza de pele",
      profissionalId: ANA,
      profissionalNome: "Ana",
      competencia: "2026-11-01",
      baseCentavos: 10000,
      percentual: 40,
      valorCentavos: 4000,
      status: "aberta",
      pagoEm: null,
    });
    expect(r.totais).toEqual({ abertoCentavos: 8000, pagoCentavos: 7000 });
    expect(r.profissionais).toEqual([
      { id: ANA, nome: "Ana" },
      { id: BIA, nome: "Bia" },
    ]);
  });

  it("Todas não filtra status; profissional filtra linhas, resumo e totais", async () => {
    const falso = criarSupabaseFalso();
    falso.responder("rpc:resumo_comissoes", ok(resumo));
    falso.responder("comissoes", ok([comissao({ profissional_id: BIA, colaboradores: { nome: "Bia" } })]));
    const r = await carregarComissoes(falso.cliente as never, { ...PERIODO, situacao: "todas", profissionalId: BIA });
    const f = falso.chamadasDe("comissoes").map((c) => [c.metodo, ...c.args]);
    expect(f.some(([m, col]) => m === "eq" && col === "status")).toBe(false);
    expect(f).toContainEqual(["eq", "profissional_id", BIA]);
    expect(r.resumo.map((x) => x.nome)).toEqual(["Bia"]);
    expect(r.totais).toEqual({ abertoCentavos: 0, pagoCentavos: 3000 });
    // A lista de profissionais do filtro continua completa.
    expect(r.profissionais.map((p) => p.nome)).toEqual(["Ana", "Bia"]);
  });

  it("período no meio do mês pega a competência do mês inteiro", async () => {
    const falso = criarSupabaseFalso();
    falso.responder("rpc:resumo_comissoes", ok([]));
    falso.responder("comissoes", ok([]));
    await carregarComissoes(falso.cliente as never, {
      de: "2026-11-15",
      ate: "2026-11-20",
      situacao: "paga",
      profissionalId: null,
    });
    const f = falso.chamadasDe("comissoes").map((c) => [c.metodo, ...c.args]);
    expect(f).toContainEqual(["gte", "competencia", "2026-11-01"]);
    expect(f).toContainEqual(["eq", "status", "paga"]);
  });

  it("erro do banco vira exceção", async () => {
    const falso = criarSupabaseFalso();
    falso.responder("rpc:resumo_comissoes", { data: null, error: { message: "Acesso não autorizado" } });
    falso.responder("comissoes", ok([]));
    await expect(
      carregarComissoes(falso.cliente as never, { ...PERIODO, situacao: "aberta", profissionalId: null }),
    ).rejects.toThrow("Acesso não autorizado");
  });
});
