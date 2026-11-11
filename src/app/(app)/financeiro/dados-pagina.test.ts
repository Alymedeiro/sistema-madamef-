import { describe, expect, it, vi } from "vitest";
import { criarSupabaseFalso } from "@/test/supabase-falso";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => null }));

import { carregarDadosDaPagina } from "./dados-pagina";

const ok = (data: unknown) => ({ data, error: null });
const erro = { data: null, error: { message: "boom" } };
const agora = new Date("2026-11-10T15:00:00Z");
const base = {
  de: "2026-11-01",
  ate: "2026-11-30",
  situacao: "aberta" as const,
  busca: "",
  categoria: "",
  hoje: "2026-11-10",
  agora,
};

describe("carregarDadosDaPagina", () => {
  it("caixa: resumo e equipe com falha não derrubam a página (resumo nulo, equipe vazia)", async () => {
    const falso = criarSupabaseFalso();
    falso.responder("rpc:gerar_contas_fixas", erro);
    falso.responder("colaboradores", erro);
    const d = await carregarDadosDaPagina(falso.cliente as never, { ...base, aba: "caixa" });
    expect(d).toMatchObject({ resumo: null, colaboradoras: [], pagar: null, receber: null, fluxo: null });
  });

  it("caixa: falha só no resumo_financeiro também vira resumo nulo", async () => {
    const falso = criarSupabaseFalso();
    falso.responder("rpc:gerar_contas_fixas", ok(0));
    falso.responder("rpc:resumo_financeiro", erro);
    falso.responder("colaboradores", ok([{ id: "c1", nome: "Ana" }]));
    const d = await carregarDadosDaPagina(falso.cliente as never, { ...base, aba: "caixa" });
    expect(d.resumo).toBeNull();
    expect(d.colaboradoras).toEqual([{ id: "c1", nome: "Ana" }]);
  });

  it("outras abas: falha do resumo continua sendo erro", async () => {
    const falso = criarSupabaseFalso();
    falso.responder("rpc:gerar_contas_fixas", erro);
    await expect(
      carregarDadosDaPagina(falso.cliente as never, { ...base, aba: "painel" }),
    ).rejects.toThrow();
  });

  it("painel: próximos vencimentos só depois de gerar as contas fixas e do resumo", async () => {
    const falso = criarSupabaseFalso();
    falso.responder("rpc:gerar_contas_fixas", ok(1));
    falso.responder("rpc:resumo_financeiro", ok([{}]));
    falso.responder("colaboradores", ok([]));
    falso.responder("contas_pagar", ok([]));
    falso.responder("contas_receber", ok([]));
    const d = await carregarDadosDaPagina(falso.cliente as never, { ...base, aba: "painel" });
    expect(d.proximos).toEqual([]);
    const ordem = falso.chamadas.map((c) => c.tabela);
    const resumo = ordem.indexOf("rpc:resumo_financeiro");
    expect(ordem.indexOf("rpc:gerar_contas_fixas")).toBeLessThan(resumo);
    expect(ordem.indexOf("contas_pagar")).toBeGreaterThan(resumo);
    expect(ordem.indexOf("contas_receber")).toBeGreaterThan(resumo);
  });
});
