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

import { abrirCaixa, estadoCaixaHoje, fecharCaixa, registrarCobranca } from "./actions";

const AG = "a0000000-0000-4000-8000-0000000000a1";
const CAIXA = "d0000000-0000-4000-8000-0000000000d1";

const ok = (data: unknown): Resposta => ({ data, error: null });
const falha = (code: string, message: string): Resposta => ({ data: null, error: { code, message } });

const base = {
  agendamentoId: AG,
  desconto: "",
  partes: [{ forma: "pix" as const, valor: "100,00", parcelas: 1 }],
};

const dividido = {
  agendamentoId: AG,
  desconto: "10,00",
  partes: [
    { forma: "pix" as const, valor: "60,00", parcelas: 1 },
    { forma: "dinheiro" as const, valor: "30,00", parcelas: 1 },
  ],
};

function agendamentoExiste(extra: Record<string, unknown> = {}) {
  falso.responder(
    "agendamentos",
    ok({
      id: AG,
      status: "atendido",
      valor_previsto_centavos: 10000,
      pacote_vendido_id: null,
      ...extra,
    }),
  );
}

const proximoAno = Number(new Date().toISOString().slice(0, 4)) + 1;

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
    await expect(registrarCobranca(base)).rejects.toThrow("REDIRECT:/inicio");
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

describe("estadoCaixaHoje", () => {
  it("aberto", async () => {
    falso.responder("rpc:caixa_de_hoje", ok({ id: CAIXA, fechado_em: null }));
    expect(await estadoCaixaHoje()).toEqual({ ok: true, estado: "aberto" });
  });

  it("já fechado (a dona vê o caixa fechado)", async () => {
    perfilAtual = "dona";
    falso.responder("rpc:caixa_de_hoje", ok({ id: CAIXA, fechado_em: "2026-11-04T22:00:00Z" }));
    expect(await estadoCaixaHoje()).toEqual({ ok: true, estado: "fechado" });
  });

  it("ainda não aberto (objeto todo nulo ou null)", async () => {
    falso.responder("rpc:caixa_de_hoje", ok({ id: null, fechado_em: null }), ok(null));
    expect(await estadoCaixaHoje()).toEqual({ ok: true, estado: "nao_aberto" });
    expect(await estadoCaixaHoje()).toEqual({ ok: true, estado: "nao_aberto" });
  });

  it("erro do banco vira mensagem", async () => {
    falso.responder("rpc:caixa_de_hoje", falha("42501", "permission denied"));
    expect(await estadoCaixaHoje()).toEqual({
      ok: false,
      erro: "Você não tem permissão para esta ação.",
    });
  });
});

describe("registrarCobranca", () => {
  it("Pix + Dinheiro com desconto: uma RPC registrar_cobranca com as partes", async () => {
    agendamentoExiste();
    falso.responder("rpc:registrar_cobranca", ok("cb1"));
    const r = await registrarCobranca(dividido);
    expect(r).toEqual({ ok: true });
    expect(falso.chamadasRpc("registrar_cobranca")[0].args[0]).toEqual({
      p_origem: "agendamento",
      p_agendamento: AG,
      p_pacote: null,
      p_desconto_centavos: 1000,
      p_partes: [
        { forma: "pix", valor_centavos: 6000, parcelas: 1, vencimentos: null, valores_parcelas: null },
        { forma: "dinheiro", valor_centavos: 3000, parcelas: 1, vencimentos: null, valores_parcelas: null },
      ],
    });
    expect(revalidatePath).toHaveBeenCalledWith("/caixa");
    expect(revalidatePath).toHaveBeenCalledWith("/agenda");
    expect(revalidatePath).toHaveBeenCalledWith("/inicio");
  });

  it("o bruto vem do agendamento (valor previsto)", async () => {
    agendamentoExiste({ valor_previsto_centavos: 18000 });
    const r = await registrarCobranca(dividido);
    expect(r).toEqual({
      ok: false,
      erro: "A soma das formas de pagamento deve ser igual ao total com desconto.",
    });
    expect(falso.chamadasRpc("registrar_cobranca")).toHaveLength(0);
  });

  it("soma errada: erro e nenhuma RPC", async () => {
    agendamentoExiste();
    const r = await registrarCobranca({
      ...dividido,
      partes: [dividido.partes[0], { ...dividido.partes[1], valor: "29,99" }],
    });
    expect(r).toEqual({
      ok: false,
      erro: "A soma das formas de pagamento deve ser igual ao total com desconto.",
    });
    expect(falso.chamadasRpc("registrar_cobranca")).toHaveLength(0);
  });

  it("R$ 100,00 em 3 formas com centavos exatos", async () => {
    agendamentoExiste();
    falso.responder("rpc:registrar_cobranca", ok("cb1"));
    const r = await registrarCobranca({
      ...base,
      partes: [
        { forma: "pix", valor: "33,34", parcelas: 1 },
        { forma: "dinheiro", valor: "33,33", parcelas: 1 },
        { forma: "debito", valor: "33,33", parcelas: 1 },
      ],
    });
    expect(r).toEqual({ ok: true });
  });

  it("parte a receber vai com as parcelas de gerarParcelas somando a parte", async () => {
    agendamentoExiste();
    falso.responder("rpc:registrar_cobranca", ok("cb1"));
    const venc = `${proximoAno}-01-31`;
    const r = await registrarCobranca({
      ...base,
      partes: [
        { forma: "pix", valor: "70,00", parcelas: 1 },
        { forma: "a_receber", valor: "30,00", parcelas: 3, primeiroVencimento: venc },
      ],
    });
    expect(r).toEqual({ ok: true });
    const args = falso.chamadasRpc("registrar_cobranca")[0].args[0] as {
      p_partes: { valores_parcelas: number[] | null; vencimentos: string[] | null }[];
    };
    expect(args.p_partes[1].valores_parcelas).toEqual([1000, 1000, 1000]);
    expect(args.p_partes[1].vencimentos).toEqual([venc, `${proximoAno}-02-28`, `${proximoAno}-03-31`]);
  });

  it("formas não parceladas vão com 1 parcela", async () => {
    agendamentoExiste();
    falso.responder("rpc:registrar_cobranca", ok("cb1"));
    await registrarCobranca({ ...base, partes: [{ forma: "pix", valor: "100,00", parcelas: 5 }] });
    const args = falso.chamadasRpc("registrar_cobranca")[0].args[0] as { p_partes: { parcelas: number }[] };
    expect(args.p_partes[0].parcelas).toBe(1);
  });

  it("crédito parcelado precisa de 2 a 12 parcelas", async () => {
    agendamentoExiste();
    const r = await registrarCobranca({
      ...base,
      partes: [{ forma: "credito_parcelado", valor: "100,00", parcelas: 1 }],
    });
    expect(r).toEqual({ ok: false, erro: "Informe de 2 a 12 parcelas." });
    expect(falso.chamadasRpc("registrar_cobranca")).toHaveLength(0);
  });

  it("a receber exige vencimento de hoje em diante (sem chamar o banco)", async () => {
    const r = await registrarCobranca({
      ...base,
      partes: [{ forma: "a_receber", valor: "100,00", parcelas: 2, primeiroVencimento: "2020-01-01" }],
    });
    expect(r).toEqual({ ok: false, erro: "O primeiro vencimento não pode ser anterior a hoje." });
    expect(falso.chamadas).toHaveLength(0);
  });

  it("a receber sem vencimento é recusado", async () => {
    agendamentoExiste();
    const r = await registrarCobranca({
      ...base,
      partes: [{ forma: "a_receber", valor: "100,00", parcelas: 2 }],
    });
    expect(r).toEqual({ ok: false, erro: "Informe o primeiro vencimento." });
    expect(falso.chamadasRpc("registrar_cobranca")).toHaveLength(0);
  });

  it("valor de parte inválido usa a mensagem da Fase 1", async () => {
    const r = await registrarCobranca({ ...base, partes: [{ forma: "pix", valor: "abc", parcelas: 1 }] });
    expect(r).toEqual({ ok: false, erro: "Informe um valor válido, ex.: 150,00" });
    expect(falso.chamadas).toHaveLength(0);
  });

  it("mais de 4 formas é recusado", async () => {
    agendamentoExiste();
    const r = await registrarCobranca({
      ...base,
      partes: Array.from({ length: 5 }, () => ({ forma: "pix" as const, valor: "20,00", parcelas: 1 })),
    });
    expect(r).toEqual({ ok: false, erro: "Informe de 1 a 4 formas de pagamento." });
    expect(falso.chamadasRpc("registrar_cobranca")).toHaveLength(0);
  });

  it("desconto maior que o valor previsto é recusado", async () => {
    agendamentoExiste();
    const r = await registrarCobranca({ ...base, desconto: "200,00" });
    expect(r).toEqual({ ok: false, erro: "O desconto não pode ser maior que o valor." });
    expect(falso.chamadasRpc("registrar_cobranca")).toHaveLength(0);
  });

  it("exige agendamento válido", async () => {
    // @ts-expect-error agendamentoId é obrigatório
    const r = await registrarCobranca({ ...base, agendamentoId: undefined });
    expect(r.ok).toBe(false);
    expect(falso.chamadas).toHaveLength(0);
  });

  it("recusa atendimento que não está atendido", async () => {
    agendamentoExiste({ status: "confirmado" });
    const r = await registrarCobranca(base);
    expect(r).toEqual({
      ok: false,
      erro: "Só é possível lançar pagamento de atendimento concluído.",
    });
    expect(falso.chamadasRpc("registrar_cobranca")).toHaveLength(0);
  });

  it("sessão de pacote não gera cobrança", async () => {
    agendamentoExiste({ pacote_vendido_id: "e0000000-0000-4000-8000-0000000000e1" });
    const r = await registrarCobranca(base);
    expect(r).toEqual({ ok: false, erro: "Sessão de pacote: já paga na venda do pacote." });
    expect(falso.chamadasRpc("registrar_cobranca")).toHaveLength(0);
  });

  it("agendamento inexistente", async () => {
    falso.responder("agendamentos", ok(null));
    const r = await registrarCobranca(base);
    expect(r).toEqual({ ok: false, erro: "Agendamento não encontrado." });
    expect(falso.chamadasRpc("registrar_cobranca")).toHaveLength(0);
  });

  it("segunda cobrança (duplo toque): 23505 em cobrancas_agendamento_unico", async () => {
    agendamentoExiste();
    falso.responder(
      "rpc:registrar_cobranca",
      falha("23505", 'duplicate key value violates unique constraint "cobrancas_agendamento_unico"'),
    );
    expect(await registrarCobranca(base)).toEqual({ ok: false, erro: "Este atendimento já foi pago." });
  });

  it("repassa a mensagem do banco (caixa fechado)", async () => {
    agendamentoExiste();
    falso.responder(
      "rpc:registrar_cobranca",
      falha("P0001", "Abra o caixa do dia antes de lançar pagamentos"),
    );
    expect(await registrarCobranca(base)).toEqual({
      ok: false,
      erro: "Abra o caixa do dia antes de lançar pagamentos",
    });
  });

  it("dona também pode cobrar", async () => {
    perfilAtual = "dona";
    agendamentoExiste();
    falso.responder("rpc:registrar_cobranca", ok("cb1"));
    expect(await registrarCobranca(base)).toEqual({ ok: true });
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
