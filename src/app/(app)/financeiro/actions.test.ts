import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Perfil } from "@/lib/dominio/permissoes";
import { criarSupabaseFalso, type Resposta } from "@/test/supabase-falso";

let perfilAtual: Perfil | null = "dona";
const exigirPerfil = vi.fn(async (...perfis: Perfil[]) => {
  if (!perfilAtual) throw new Error("REDIRECT:/login");
  if (perfis.length > 0 && !perfis.includes(perfilAtual)) throw new Error("REDIRECT:/inicio");
  return { userId: "u1", colaborador: { id: "c1", nome: "Fê", perfil: perfilAtual } };
});
vi.mock("@/lib/sessao", () => ({ exigirPerfil: (...p: Perfil[]) => exigirPerfil(...p) }));
const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => revalidatePath(...a) }));

let falso = criarSupabaseFalso();
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => falso.cliente }));

import {
  cancelarConta,
  criarContaFixa,
  criarContaPagar,
  desativarContaFixa,
  editarContaPagar,
  lancarVale,
  pagarConta,
  urlAnexo,
} from "./actions";

const CONTA = "b0000000-0000-4000-8000-0000000000b1";
const COLAB = "c0000000-0000-4000-8000-0000000000c2";
const ANEXO = "contas_pagar/a0000000-0000-4000-8000-0000000000a1.pdf";

const ok = (data: unknown): Resposta => ({ data, error: null });
const falha = (code: string, message: string): Resposta => ({ data: null, error: { code, message } });

const conta = {
  descricao: "Aluguel",
  categoria: "aluguel" as const,
  fornecedor: "Imobiliária",
  valor: "1.234,56",
  vencimento: "2026-11-15",
  anexoPath: null,
};

beforeEach(() => {
  perfilAtual = "dona";
  falso = criarSupabaseFalso();
  exigirPerfil.mockClear();
  revalidatePath.mockClear();
});

describe("guarda de perfil", () => {
  it("recepção é negada em todas as ações sem chamar o banco", async () => {
    perfilAtual = "recepcao";
    await expect(criarContaPagar(conta)).rejects.toThrow("REDIRECT:/inicio");
    await expect(editarContaPagar({ ...conta, contaId: CONTA })).rejects.toThrow("REDIRECT:/inicio");
    await expect(pagarConta({ contaId: CONTA, pagoEm: "2026-11-10", forma: "pix" })).rejects.toThrow(
      "REDIRECT:/inicio",
    );
    await expect(cancelarConta({ tipo: "pagar", contaId: CONTA, motivo: "x" })).rejects.toThrow(
      "REDIRECT:/inicio",
    );
    await expect(
      lancarVale({ colaboradorId: COLAB, valor: "50,00", data: "2026-11-10", forma: "pix" }),
    ).rejects.toThrow("REDIRECT:/inicio");
    await expect(
      criarContaFixa({ ...conta, dia: 10, inicio: "2026-11-01" }),
    ).rejects.toThrow("REDIRECT:/inicio");
    await expect(desativarContaFixa(CONTA)).rejects.toThrow("REDIRECT:/inicio");
    await expect(urlAnexo(CONTA)).rejects.toThrow("REDIRECT:/inicio");
    for (const c of exigirPerfil.mock.calls) expect(c).toEqual(["dona"]);
    expect(falso.chamadas).toHaveLength(0);
  });
});

describe("criarContaPagar", () => {
  it('converte "1.234,56" em 123456 e chama criar_conta_pagar', async () => {
    falso.responder("rpc:criar_conta_pagar", ok(CONTA));
    const r = await criarContaPagar({ ...conta, anexoPath: ANEXO });
    expect(r).toEqual({ ok: true });
    expect(falso.chamadasRpc("criar_conta_pagar")[0].args[0]).toEqual({
      p_descricao: "Aluguel",
      p_categoria: "aluguel",
      p_fornecedor: "Imobiliária",
      p_valor_centavos: 123456,
      p_vencimento: "2026-11-15",
      p_anexo_path: ANEXO,
    });
    expect(revalidatePath).toHaveBeenCalledWith("/financeiro");
  });

  it("fornecedor vazio vira null", async () => {
    falso.responder("rpc:criar_conta_pagar", ok(CONTA));
    await criarContaPagar({ ...conta, fornecedor: "  " });
    expect(falso.chamadasRpc("criar_conta_pagar")[0].args[0]).toMatchObject({ p_fornecedor: null });
  });

  it("recusa categoria vale, valor zero, data inválida e anexo fora do padrão antes do banco", async () => {
    expect(await criarContaPagar({ ...conta, categoria: "vale" as never })).toMatchObject({ ok: false });
    expect(await criarContaPagar({ ...conta, valor: "0,00" })).toMatchObject({ ok: false });
    expect(await criarContaPagar({ ...conta, vencimento: "2026-02-30" })).toMatchObject({ ok: false });
    expect(await criarContaPagar({ ...conta, descricao: " " })).toEqual({
      ok: false,
      erro: "Informe a descrição.",
    });
    expect(await criarContaPagar({ ...conta, anexoPath: "outra/coisa.exe" })).toMatchObject({
      ok: false,
    });
    expect(falso.chamadas).toHaveLength(0);
  });

  it("repassa a mensagem de anexo não encontrado e traduz 23514", async () => {
    falso.responder(
      "rpc:criar_conta_pagar",
      falha("P0001", "Anexo não encontrado. Envie o arquivo de novo."),
      falha("23514", 'new row violates check constraint "contas_pagar_check"'),
    );
    expect(await criarContaPagar({ ...conta, anexoPath: ANEXO })).toEqual({
      ok: false,
      erro: "Anexo não encontrado. Envie o arquivo de novo.",
    });
    expect(await criarContaPagar(conta)).toEqual({ ok: false, erro: "Verifique os dados da conta." });
  });
});

describe("editarContaPagar", () => {
  it("chama editar_conta_pagar com a conta e anexo null remove", async () => {
    falso.responder("rpc:editar_conta_pagar", ok(null));
    const r = await editarContaPagar({ ...conta, contaId: CONTA, anexoPath: null });
    expect(r).toEqual({ ok: true });
    expect(falso.chamadasRpc("editar_conta_pagar")[0].args[0]).toEqual({
      p_conta: CONTA,
      p_descricao: "Aluguel",
      p_categoria: "aluguel",
      p_fornecedor: "Imobiliária",
      p_valor_centavos: 123456,
      p_vencimento: "2026-11-15",
      p_anexo_path: null,
    });
  });
});

describe("pagarConta", () => {
  it("chama pagar_conta e repassa Esta conta já foi paga.", async () => {
    falso.responder("rpc:pagar_conta", ok(null), falha("P0001", "Esta conta já foi paga."));
    const e = { contaId: CONTA, pagoEm: "2026-11-10", forma: "pix" as const };
    expect(await pagarConta(e)).toEqual({ ok: true });
    expect(falso.chamadasRpc("pagar_conta")[0].args[0]).toEqual({
      p_conta: CONTA,
      p_pago_em: "2026-11-10",
      p_forma: "pix",
    });
    expect(await pagarConta(e)).toEqual({ ok: false, erro: "Esta conta já foi paga." });
  });

  it("recusa forma a_receber antes do banco", async () => {
    const r = await pagarConta({ contaId: CONTA, pagoEm: "2026-11-10", forma: "a_receber" as never });
    expect(r).toMatchObject({ ok: false });
    expect(falso.chamadas).toHaveLength(0);
  });
});

describe("cancelarConta", () => {
  it("sem motivo é recusado antes do banco", async () => {
    const r = await cancelarConta({ tipo: "pagar", contaId: CONTA, motivo: "   " });
    expect(r).toEqual({ ok: false, erro: "Informe o motivo do cancelamento." });
    const longo = await cancelarConta({ tipo: "pagar", contaId: CONTA, motivo: "x".repeat(201) });
    expect(longo).toMatchObject({ ok: false });
    expect(falso.chamadas).toHaveLength(0);
  });

  it("pagar → cancelar_conta_pagar; receber → cancelar_conta_receber", async () => {
    falso.responder("rpc:cancelar_conta_pagar", ok(null));
    falso.responder("rpc:cancelar_conta_receber", ok(null));
    expect(await cancelarConta({ tipo: "pagar", contaId: CONTA, motivo: " Duplicada " })).toEqual({
      ok: true,
    });
    expect(await cancelarConta({ tipo: "receber", contaId: CONTA, motivo: "Desistiu" })).toEqual({
      ok: true,
    });
    expect(falso.chamadasRpc("cancelar_conta_pagar")[0].args[0]).toEqual({
      p_conta: CONTA,
      p_motivo: "Duplicada",
    });
    expect(falso.chamadasRpc("cancelar_conta_receber")[0].args[0]).toEqual({
      p_conta: CONTA,
      p_motivo: "Desistiu",
    });
  });
});

describe("lancarVale", () => {
  it("chama lancar_vale com os argumentos certos", async () => {
    falso.responder("rpc:lancar_vale", ok(CONTA));
    const r = await lancarVale({
      colaboradorId: COLAB,
      valor: "1.234,56",
      data: "2026-11-10",
      forma: "dinheiro",
      obs: " adiantamento ",
    });
    expect(r).toEqual({ ok: true });
    expect(falso.chamadasRpc("lancar_vale")[0].args[0]).toEqual({
      p_colaborador: COLAB,
      p_valor_centavos: 123456,
      p_data: "2026-11-10",
      p_forma: "dinheiro",
      p_obs: "adiantamento",
    });
  });

  it("sem observação manda null; repassa Colaboradora não encontrada.", async () => {
    falso.responder("rpc:lancar_vale", falha("P0001", "Colaboradora não encontrada."));
    const r = await lancarVale({ colaboradorId: COLAB, valor: "50", data: "2026-11-10", forma: "pix" });
    expect(r).toEqual({ ok: false, erro: "Colaboradora não encontrada." });
    expect(falso.chamadasRpc("lancar_vale")[0].args[0]).toMatchObject({ p_obs: null });
  });
});

describe("criarContaFixa", () => {
  const fixa = { ...conta, dia: 10, inicio: "2026-11-01" };

  it("dia 0 ou 32 é recusado antes do banco", async () => {
    expect(await criarContaFixa({ ...fixa, dia: 0 })).toMatchObject({ ok: false });
    expect(await criarContaFixa({ ...fixa, dia: 32 })).toMatchObject({ ok: false });
    expect(falso.chamadas).toHaveLength(0);
  });

  it("chama criar_conta_fixa", async () => {
    falso.responder("rpc:criar_conta_fixa", ok(CONTA));
    expect(await criarContaFixa({ ...fixa, dia: 31 })).toEqual({ ok: true });
    expect(falso.chamadasRpc("criar_conta_fixa")[0].args[0]).toEqual({
      p_descricao: "Aluguel",
      p_categoria: "aluguel",
      p_fornecedor: "Imobiliária",
      p_valor_centavos: 123456,
      p_dia: 31,
      p_inicio: "2026-11-01",
    });
  });

  it("desativarContaFixa chama desativar_conta_fixa", async () => {
    falso.responder("rpc:desativar_conta_fixa", ok(null));
    expect(await desativarContaFixa(CONTA)).toEqual({ ok: true });
    expect(falso.chamadasRpc("desativar_conta_fixa")[0].args[0]).toEqual({ p_id: CONTA });
    expect(await desativarContaFixa("nao-e-uuid")).toMatchObject({ ok: false });
  });
});

describe("urlAnexo", () => {
  it("assina o anexo da conta por 300 s", async () => {
    falso.responder("contas_pagar", ok({ anexo_path: ANEXO }));
    const r = await urlAnexo(CONTA);
    expect(r).toEqual({ ok: true, url: `https://assinada/${ANEXO}` });
    const assinatura = falso.chamadasDe("storage:financeiro", "createSignedUrl");
    expect(assinatura[0].args).toEqual([ANEXO, 300]);
  });

  it("conta sem anexo → erro, sem assinar", async () => {
    falso.responder("contas_pagar", ok({ anexo_path: null }));
    expect(await urlAnexo(CONTA)).toEqual({ ok: false, erro: "Anexo não encontrado." });
    expect(falso.chamadasDe("storage:financeiro")).toHaveLength(0);
  });
});
