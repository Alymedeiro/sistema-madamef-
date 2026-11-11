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
