import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Perfil } from "@/lib/dominio/permissoes";
import { criarSupabaseFalso, type Resposta } from "@/test/supabase-falso";

let perfilAtual: Perfil | null = "recepcao";
const EU = "c0000000-0000-4000-8000-00000000000c";
const exigirPerfil = vi.fn(async (...perfis: Perfil[]) => {
  if (!perfilAtual) throw new Error("REDIRECT:/login");
  if (perfis.length > 0 && !perfis.includes(perfilAtual)) throw new Error("REDIRECT:/inicio");
  return { userId: "u1", colaborador: { id: EU, nome: "Teste", perfil: perfilAtual } };
});
vi.mock("@/lib/sessao", () => ({ exigirPerfil: (...p: Perfil[]) => exigirPerfil(...p) }));
const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => revalidatePath(...a) }));

let falso = criarSupabaseFalso();
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => falso.cliente }));

import { abrirCaixa, fecharCaixa, registrarPagamento } from "./actions";

const AG = "a0000000-0000-4000-8000-0000000000a1";
const CLIENTE_DO_AG = "c1111111-1111-4111-8111-111111111111";
const OUTRA_CLIENTE = "c2222222-2222-4222-8222-222222222222";
const CAIXA = "d0000000-0000-4000-8000-0000000000d1";

const ok = (data: unknown): Resposta => ({ data, error: null });
const falha = (code: string, message: string): Resposta => ({ data: null, error: { code, message } });

const base = {
  clienteId: OUTRA_CLIENTE,
  agendamentoId: AG,
  forma: "pix" as const,
  valor: "180,00",
  desconto: "",
  parcelas: 1,
};

function agendamentoExiste() {
  falso.responder("agendamentos", ok({ id: AG, cliente_id: CLIENTE_DO_AG }));
}

beforeEach(() => {
  perfilAtual = "recepcao";
  falso = criarSupabaseFalso();
  exigirPerfil.mockClear();
  revalidatePath.mockClear();
});

describe("guarda de perfil", () => {
  it("profissional é rejeitada em todas as ações", async () => {
    perfilAtual = "profissional";
    await expect(abrirCaixa("50,00")).rejects.toThrow("REDIRECT:/inicio");
    await expect(registrarPagamento(base)).rejects.toThrow("REDIRECT:/inicio");
    await expect(fecharCaixa(CAIXA, "50,00")).rejects.toThrow("REDIRECT:/inicio");
    expect(exigirPerfil).toHaveBeenCalledWith("dona", "recepcao");
    expect(falso.chamadas).toHaveLength(0);
  });
});

describe("abrirCaixa", () => {
  it("converte o valor com parseBRL e chama abrir_caixa", async () => {
    falso.responder("rpc:abrir_caixa", ok(CAIXA));
    const r = await abrirCaixa("1.234,5");
    expect(r).toEqual({ ok: true });
    expect(falso.chamadasRpc("abrir_caixa")[0].args[0]).toEqual({
      p_valor_inicial_centavos: 123450,
    });
    expect(revalidatePath).toHaveBeenCalledWith("/caixa");
  });

  it("valor inválido não chama o banco", async () => {
    const r = await abrirCaixa("abc");
    expect(r).toEqual({ ok: false, erro: "Informe um valor válido, ex.: 150,00" });
    expect(falso.chamadas).toHaveLength(0);
  });

  it("caixa de hoje já aberto: trata como sucesso", async () => {
    falso.responder("rpc:abrir_caixa", falha("P0001", "Já existe caixa para hoje"));
    falso.responder("rpc:caixa_de_hoje", ok({ id: CAIXA, fechado_em: null }));
    expect(await abrirCaixa("0")).toEqual({ ok: true });
  });

  it("caixa de hoje já fechado (recepção não o enxerga)", async () => {
    falso.responder("rpc:abrir_caixa", falha("P0001", "Já existe caixa para hoje"));
    falso.responder("rpc:caixa_de_hoje", ok({ id: null, fechado_em: null }));
    expect(await abrirCaixa("0")).toEqual({ ok: false, erro: "O caixa de hoje já foi fechado." });
  });
});

describe("registrarPagamento", () => {
  it("deriva a cliente do agendamento, ignorando a enviada", async () => {
    agendamentoExiste();
    falso.responder("rpc:registrar_pagamento", ok("pg1"));
    const r = await registrarPagamento({ ...base, desconto: "10,50" });
    expect(r).toEqual({ ok: true });
    expect(falso.chamadasRpc("registrar_pagamento")[0].args[0]).toEqual({
      p_cliente: CLIENTE_DO_AG,
      p_agendamento: AG,
      p_forma: "pix",
      p_valor_centavos: 18000,
      p_desconto_centavos: 1050,
      p_parcelas: 1,
      p_vencimentos: null,
      p_valores_parcelas: null,
    });
  });

  it("exige agendamento (Ruling R12)", async () => {
    // @ts-expect-error agendamentoId é obrigatório
    const r = await registrarPagamento({ ...base, agendamentoId: undefined });
    expect(r.ok).toBe(false);
    expect(falso.chamadas).toHaveLength(0);
  });

  it("a receber envia as parcelas de gerarParcelas sobre o valor líquido", async () => {
    agendamentoExiste();
    falso.responder("rpc:registrar_pagamento", ok("pg1"));
    const hoje = new Date().toISOString().slice(0, 4);
    const venc = `${Number(hoje) + 1}-01-31`;
    const r = await registrarPagamento({
      ...base,
      forma: "a_receber",
      valor: "100,00",
      desconto: "0,01",
      parcelas: 3,
      primeiroVencimento: venc,
    });
    expect(r).toEqual({ ok: true });
    const args = falso.chamadasRpc("registrar_pagamento")[0].args[0] as Record<string, unknown>;
    expect(args.p_valores_parcelas).toEqual([3333, 3333, 3333]);
    expect(args.p_vencimentos).toEqual([venc, `${Number(hoje) + 1}-02-28`, `${Number(hoje) + 1}-03-31`]);
    expect(args.p_parcelas).toBe(3);
    expect((args.p_valores_parcelas as number[]).reduce((a, b) => a + b, 0)).toBe(9999);
  });

  it("a receber exige vencimento de hoje em diante", async () => {
    const r = await registrarPagamento({
      ...base,
      forma: "a_receber",
      parcelas: 2,
      primeiroVencimento: "2020-01-01",
    });
    expect(r).toEqual({ ok: false, erro: "O primeiro vencimento não pode ser anterior a hoje." });
    expect(falso.chamadas).toHaveLength(0);
  });

  it("a receber sem vencimento é recusado", async () => {
    const r = await registrarPagamento({ ...base, forma: "a_receber", parcelas: 2 });
    expect(r.ok).toBe(false);
  });

  it("crédito parcelado precisa de 2 a 12 parcelas; demais formas usam 1", async () => {
    expect((await registrarPagamento({ ...base, forma: "credito_parcelado", parcelas: 1 })).ok).toBe(false);
    expect((await registrarPagamento({ ...base, forma: "credito_parcelado", parcelas: 13 })).ok).toBe(false);
    agendamentoExiste();
    falso.responder("rpc:registrar_pagamento", ok("pg1"));
    await registrarPagamento({ ...base, forma: "pix", parcelas: 5 });
    expect((falso.chamadasRpc("registrar_pagamento")[0].args[0] as { p_parcelas: number }).p_parcelas).toBe(1);
  });

  it("desconto maior que o valor é recusado sem chamar o banco", async () => {
    const r = await registrarPagamento({ ...base, desconto: "200,00" });
    expect(r).toEqual({ ok: false, erro: "O desconto não pode ser maior que o valor." });
    expect(falso.chamadas).toHaveLength(0);
  });

  it("repassa a mensagem do banco (caixa fechado)", async () => {
    agendamentoExiste();
    falso.responder(
      "rpc:registrar_pagamento",
      falha("P0001", "Abra o caixa do dia antes de lançar pagamentos"),
    );
    expect(await registrarPagamento(base)).toEqual({
      ok: false,
      erro: "Abra o caixa do dia antes de lançar pagamentos",
    });
  });

  it("agendamento inexistente", async () => {
    falso.responder("agendamentos", ok(null));
    const r = await registrarPagamento(base);
    expect(r).toEqual({ ok: false, erro: "Agendamento não encontrado." });
    expect(falso.chamadasRpc("registrar_pagamento")).toHaveLength(0);
  });
});

describe("fecharCaixa", () => {
  it("devolve a diferença calculada pelo banco", async () => {
    falso.responder(
      "rpc:fechar_caixa",
      ok({ total_por_forma: {}, total_geral: 19500, dinheiro_esperado: 12500, diferenca: -300 }),
    );
    const r = await fecharCaixa(CAIXA, "122,00");
    expect(r).toEqual({ ok: true, diferencaCentavos: -300, dinheiroEsperadoCentavos: 12500 });
    expect(falso.chamadasRpc("fechar_caixa")[0].args[0]).toEqual({
      p_caixa: CAIXA,
      p_valor_contado_centavos: 12200,
    });
  });

  it("repassa a mensagem do banco", async () => {
    falso.responder("rpc:fechar_caixa", falha("P0001", "Este caixa já foi fechado"));
    expect(await fecharCaixa(CAIXA, "0")).toEqual({ ok: false, erro: "Este caixa já foi fechado" });
  });

  it("id inválido e valor inválido não chamam o banco", async () => {
    expect((await fecharCaixa("x", "10")).ok).toBe(false);
    expect((await fecharCaixa(CAIXA, "")).ok).toBe(false);
    expect(falso.chamadas).toHaveLength(0);
  });
});
