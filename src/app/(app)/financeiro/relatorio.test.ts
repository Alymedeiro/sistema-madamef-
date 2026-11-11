import { describe, expect, it, vi } from "vitest";
import { criarSupabaseFalso } from "@/test/supabase-falso";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => null }));

import { conteudoDoRelatorio, parametrosDoRelatorio } from "./relatorio";

const ok = (data: unknown) => ({ data, error: null });
const agora = new Date("2026-11-10T15:00:00Z");
const AVISO = "Mostrando as 500 primeiras — refine o filtro.";

const receber = (i: number) => ({
  id: `r${i}`,
  cliente_id: "c1",
  descricao: "Saldo",
  numero: 1,
  total_parcelas: 1,
  valor_centavos: 100,
  vencimento: "2026-11-20",
  recebido_em: null,
  cancelada_em: null,
  origem_manual: true,
  clientes: { nome: "Maria" },
});
const pagar = (i: number) => ({
  id: `p${i}`,
  descricao: "Conta",
  categoria: "outros",
  fornecedor: null,
  valor_centavos: 100,
  vencimento: "2026-11-20",
  status: "aberta",
  pago_em: null,
  forma: null,
  anexo_path: null,
  conta_fixa_id: null,
  colaborador: null,
});
const varias = <T,>(n: number, f: (i: number) => T) => Array.from({ length: n }, (_, i) => f(i));

describe("conteudoDoRelatorio: limite de 500 linhas", () => {
  it("receber com 500 linhas avisa no PDF; com 499, não", async () => {
    const p = parametrosDoRelatorio(new URLSearchParams("aba=receber"), agora);
    const cheio = criarSupabaseFalso();
    cheio.responder("contas_receber", ok(varias(500, receber)));
    expect((await conteudoDoRelatorio(cheio.cliente as never, p, agora)).filtros).toContain(AVISO);
    const menos = criarSupabaseFalso();
    menos.responder("contas_receber", ok(varias(499, receber)));
    expect((await conteudoDoRelatorio(menos.cliente as never, p, agora)).filtros).not.toContain(AVISO);
  });

  it("pagar com 500 linhas avisa no PDF", async () => {
    const p = parametrosDoRelatorio(new URLSearchParams("aba=pagar"), agora);
    const falso = criarSupabaseFalso();
    falso.responder("rpc:gerar_contas_fixas", ok(0));
    falso.responder("rpc:resumo_financeiro", ok([{}]));
    falso.responder("contas_pagar", ok(varias(500, pagar)));
    expect((await conteudoDoRelatorio(falso.cliente as never, p, agora)).filtros).toContain(AVISO);
  });
});

describe("conteudoDoRelatorio: comissões", () => {
  const ANA = "a0000000-0000-4000-8000-0000000000a1";
  const linhaComissao = (status: string) => ({
    id: `k-${status}`,
    profissional_id: ANA,
    competencia: "2026-11-01",
    base_centavos: 15000,
    percentual: 12.5,
    valor_centavos: 1875,
    status,
    pago_em: status === "paga" ? "2026-11-09" : null,
    agendamentos: { inicio: "2026-11-05T13:00:00Z", clientes: { nome: "Maria" } },
    servicos: { nome: "Limpeza de pele" },
    colaboradores: { nome: "Ana" },
  });

  it("colunas, linhas, filtros e totais A pagar / Pago", async () => {
    const p = parametrosDoRelatorio(
      new URLSearchParams(`aba=comissoes&situacao=todas&profissional=${ANA}`),
      agora,
    );
    expect(p.aba).toBe("comissoes");
    const falso = criarSupabaseFalso();
    falso.responder(
      "rpc:resumo_comissoes",
      ok([
        { profissional_id: ANA, nome: "Ana", competencia: "2026-11-01", qtd: 2, base: 30000, aberto: 1875, pago: 1875 },
        { profissional_id: "outra", nome: "Bia", competencia: "2026-11-01", qtd: 1, base: 100, aberto: 50, pago: 0 },
      ]),
    );
    falso.responder("comissoes", ok([linhaComissao("aberta"), linhaComissao("paga")]), ok([]));
    const c = await conteudoDoRelatorio(falso.cliente as never, p, agora);
    expect(c.colunas).toEqual(["Data", "Cliente", "Serviço", "Profissional", "Base", "%", "Valor", "Situação"]);
    expect(c.linhas[0]).toEqual([
      "05/11/2026",
      "Maria",
      "Limpeza de pele",
      "Ana",
      "R$ 150,00",
      "12,5%",
      "R$ 18,75",
      "Em aberto",
    ]);
    expect(c.linhas[1][7]).toBe("Paga");
    expect(c.filtros).toEqual(["Situação: Todas", "Profissional: Ana"]);
    expect(c.totais).toEqual([
      ["A pagar", "R$ 18,75"],
      ["Pago", "R$ 18,75"],
    ]);
  });

  it("padrão Em aberto; situação de contas (vencida) cai no padrão", async () => {
    const p = parametrosDoRelatorio(new URLSearchParams("aba=comissoes&situacao=vencida"), agora);
    const falso = criarSupabaseFalso();
    falso.responder("rpc:resumo_comissoes", ok([]));
    falso.responder("comissoes", ok([]));
    const c = await conteudoDoRelatorio(falso.cliente as never, p, agora);
    expect(falso.chamadasDe("comissoes", "eq").map((x) => x.args)).toContainEqual(["status", "aberta"]);
    expect(c.filtros).toEqual(["Situação: Em aberto"]);
    expect(c.totais).toEqual([
      ["A pagar", "R$ 0,00"],
      ["Pago", "R$ 0,00"],
    ]);
  });
});
