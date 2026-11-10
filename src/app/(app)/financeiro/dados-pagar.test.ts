import { describe, expect, it, vi } from "vitest";
import { criarSupabaseFalso } from "@/test/supabase-falso";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => null }));

import { listarContasFixas, listarContasPagar } from "./dados";

const ok = (data: unknown) => ({ data, error: null });
const HOJE = "2026-11-10";
const PERIODO = { de: "2026-11-01", ate: "2026-11-30" };

const linha = (extra: Record<string, unknown> = {}) => ({
  id: "p1",
  descricao: "Aluguel",
  categoria: "aluguel",
  fornecedor: "Imobiliária",
  valor_centavos: 350000,
  vencimento: "2026-11-05",
  status: "aberta",
  pago_em: null,
  forma: null,
  anexo_path: null,
  conta_fixa_id: null,
  colaborador: null,
  ...extra,
});

function filtros(falso: ReturnType<typeof criarSupabaseFalso>) {
  return falso.chamadasDe("contas_pagar").map((c) => [c.metodo, ...c.args]);
}

describe("listarContasPagar", () => {
  it("vencida = aberta e vencimento < hoje (sem limite do período)", async () => {
    const falso = criarSupabaseFalso();
    falso.responder("contas_pagar", ok([linha()]));
    const r = await listarContasPagar(
      falso.cliente as never,
      { ...PERIODO, situacao: "vencida" },
      HOJE,
    );
    const f = filtros(falso);
    expect(f).toContainEqual(["eq", "status", "aberta"]);
    expect(f).toContainEqual(["lt", "vencimento", HOJE]);
    expect(f.some(([m, col]) => m === "gte" && col === "vencimento")).toBe(false);
    expect(r[0]).toMatchObject({ id: "p1", situacao: "vencida", valorCentavos: 350000 });
  });

  it("em aberto (padrão): abertas do período e também as vencidas antes dele", async () => {
    const falso = criarSupabaseFalso();
    falso.responder("contas_pagar", ok([]));
    await listarContasPagar(falso.cliente as never, { ...PERIODO }, HOJE);
    const f = filtros(falso);
    expect(f).toContainEqual(["eq", "status", "aberta"]);
    expect(f).toContainEqual(["lte", "vencimento", "2026-11-30"]);
    expect(f).toContainEqual(["or", `vencimento.gte.2026-11-01,vencimento.lt.${HOJE}`]);
  });

  it("pagas filtram por pago_em no período; canceladas e todas por vencimento", async () => {
    const pagas = criarSupabaseFalso();
    pagas.responder("contas_pagar", ok([]));
    await listarContasPagar(pagas.cliente as never, { ...PERIODO, situacao: "paga" }, HOJE);
    expect(filtros(pagas)).toContainEqual(["eq", "status", "paga"]);
    expect(filtros(pagas)).toContainEqual(["gte", "pago_em", "2026-11-01"]);
    expect(filtros(pagas)).toContainEqual(["lte", "pago_em", "2026-11-30"]);

    const canceladas = criarSupabaseFalso();
    canceladas.responder("contas_pagar", ok([]));
    await listarContasPagar(canceladas.cliente as never, { ...PERIODO, situacao: "cancelada" }, HOJE);
    expect(filtros(canceladas)).toContainEqual(["eq", "status", "cancelada"]);
    expect(filtros(canceladas)).toContainEqual(["gte", "vencimento", "2026-11-01"]);

    const todas = criarSupabaseFalso();
    todas.responder("contas_pagar", ok([]));
    await listarContasPagar(todas.cliente as never, { ...PERIODO, situacao: "todas" }, HOJE);
    expect(filtros(todas).some(([m, col]) => m === "eq" && col === "status")).toBe(false);
    expect(filtros(todas)).toContainEqual(["gte", "vencimento", "2026-11-01"]);
    expect(filtros(todas)).toContainEqual(["lte", "vencimento", "2026-11-30"]);
  });

  it("busca em descrição/fornecedor (sem caracteres de filtro) e categoria válida", async () => {
    const falso = criarSupabaseFalso();
    falso.responder("contas_pagar", ok([]));
    await listarContasPagar(
      falso.cliente as never,
      { ...PERIODO, situacao: "todas", busca: " luz, (enel)% ", categoria: "outros" },
      HOJE,
    );
    const f = filtros(falso);
    expect(f).toContainEqual(["or", "descricao.ilike.%luz enel%,fornecedor.ilike.%luz enel%"]);
    expect(f).toContainEqual(["eq", "categoria", "outros"]);

    const invalida = criarSupabaseFalso();
    invalida.responder("contas_pagar", ok([]));
    await listarContasPagar(
      invalida.cliente as never,
      { ...PERIODO, situacao: "todas", categoria: "xyz" },
      HOJE,
    );
    expect(filtros(invalida).some(([m, col]) => m === "eq" && col === "categoria")).toBe(false);
  });

  it("mapeia a linha: vale mostra a colaboradora; anexo e conta fixa viram flags", async () => {
    const falso = criarSupabaseFalso();
    falso.responder(
      "contas_pagar",
      ok([
        linha({
          id: "v1",
          categoria: "vale",
          fornecedor: null,
          status: "paga",
          pago_em: "2026-11-09",
          forma: "pix",
          vencimento: "2026-11-09",
          colaborador: { nome: "Ana" },
        }),
        linha({ id: "p2", vencimento: "2026-11-20", anexo_path: "contas_pagar/x.pdf", conta_fixa_id: "f1" }),
      ]),
    );
    const r = await listarContasPagar(falso.cliente as never, { ...PERIODO, situacao: "todas" }, HOJE);
    expect(r[0]).toMatchObject({ id: "v1", quem: "Ana", situacao: "paga", pagoEm: "2026-11-09" });
    expect(r[1]).toMatchObject({
      id: "p2",
      quem: "Imobiliária",
      situacao: "em_aberto",
      anexoPath: "contas_pagar/x.pdf",
      fixa: true,
    });
  });

  it("erro do banco é lançado", async () => {
    const falso = criarSupabaseFalso();
    falso.responder("contas_pagar", { data: null, error: { message: "boom" } });
    await expect(listarContasPagar(falso.cliente as never, { ...PERIODO }, HOJE)).rejects.toThrow(/boom/);
  });
});

describe("listarContasFixas", () => {
  it("só as ativas, por descrição", async () => {
    const falso = criarSupabaseFalso();
    falso.responder(
      "contas_fixas",
      ok([{ id: "f1", descricao: "Aluguel", categoria: "aluguel", valor_centavos: 350000, dia_vencimento: 5 }]),
    );
    const r = await listarContasFixas(falso.cliente as never);
    expect(falso.chamadasDe("contas_fixas").map((c) => [c.metodo, ...c.args])).toContainEqual([
      "eq",
      "ativa",
      true,
    ]);
    expect(r).toEqual([
      { id: "f1", descricao: "Aluguel", categoria: "aluguel", valorCentavos: 350000, dia: 5 },
    ]);
  });
});
