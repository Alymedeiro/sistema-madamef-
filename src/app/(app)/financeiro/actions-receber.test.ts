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

import { criarContaReceber, receberParcela } from "./actions";

const CONTA = "b0000000-0000-4000-8000-0000000000b1";
const CLIENTE = "c0000000-0000-4000-8000-0000000000c3";

const ok = (data: unknown): Resposta => ({ data, error: null });
const falha = (code: string, message: string): Resposta => ({ data: null, error: { code, message } });

const nova = { clienteId: CLIENTE, descricao: "Sessão avulsa", valor: "150,00", vencimento: "2026-11-20" };

beforeEach(() => {
  perfilAtual = "dona";
  falso = criarSupabaseFalso();
  exigirPerfil.mockClear();
  revalidatePath.mockClear();
});

describe("receberParcela", () => {
  it("profissional é negada sem chamar o banco", async () => {
    perfilAtual = "profissional";
    await expect(receberParcela({ contaId: CONTA, forma: "pix" })).rejects.toThrow("REDIRECT:/inicio");
    expect(exigirPerfil).toHaveBeenCalledWith("dona", "recepcao");
    expect(falso.chamadas).toHaveLength(0);
  });

  it("recepção recebe: chama receber_parcela e revalida o Financeiro", async () => {
    perfilAtual = "recepcao";
    falso.responder("rpc:receber_parcela", ok("r1"));
    expect(await receberParcela({ contaId: CONTA, forma: "dinheiro" })).toEqual({ ok: true });
    expect(falso.chamadasRpc("receber_parcela")[0].args[0]).toEqual({ p_conta: CONTA, p_forma: "dinheiro" });
    expect(revalidatePath).toHaveBeenCalledWith("/financeiro");
  });

  it("repassa as mensagens do banco", async () => {
    falso.responder(
      "rpc:receber_parcela",
      falha("P0001", "Abra o caixa do dia antes de receber."),
      falha("P0001", "Esta parcela já foi recebida."),
      falha("P0001", "Esta conta foi cancelada."),
    );
    const e = { contaId: CONTA, forma: "pix" as const };
    expect(await receberParcela(e)).toEqual({ ok: false, erro: "Abra o caixa do dia antes de receber." });
    expect(await receberParcela(e)).toEqual({ ok: false, erro: "Esta parcela já foi recebida." });
    expect(await receberParcela(e)).toEqual({ ok: false, erro: "Esta conta foi cancelada." });
  });

  it("recusa a forma a_receber e id inválido antes do banco", async () => {
    expect(await receberParcela({ contaId: CONTA, forma: "a_receber" as never })).toMatchObject({ ok: false });
    expect(await receberParcela({ contaId: "x", forma: "pix" })).toMatchObject({ ok: false });
    expect(falso.chamadas).toHaveLength(0);
  });
});

describe("criarContaReceber", () => {
  it("só a dona", async () => {
    perfilAtual = "recepcao";
    await expect(criarContaReceber(nova)).rejects.toThrow("REDIRECT:/inicio");
    expect(exigirPerfil).toHaveBeenCalledWith("dona");
    expect(falso.chamadas).toHaveLength(0);
  });

  it('converte "150,00" em 15000 e chama criar_conta_receber', async () => {
    falso.responder("rpc:criar_conta_receber", ok(CONTA));
    expect(await criarContaReceber({ ...nova, descricao: "  Sessão avulsa " })).toEqual({ ok: true });
    expect(falso.chamadasRpc("criar_conta_receber")[0].args[0]).toEqual({
      p_cliente: CLIENTE,
      p_descricao: "Sessão avulsa",
      p_valor_centavos: 15000,
      p_vencimento: "2026-11-20",
    });
    expect(revalidatePath).toHaveBeenCalledWith("/financeiro");
  });

  it("valida descrição, valor, cliente e vencimento antes do banco", async () => {
    expect(await criarContaReceber({ ...nova, descricao: "  " })).toEqual({
      ok: false,
      erro: "Informe a descrição.",
    });
    expect(await criarContaReceber({ ...nova, descricao: "x".repeat(121) })).toEqual({
      ok: false,
      erro: "A descrição pode ter até 120 caracteres.",
    });
    expect(await criarContaReceber({ ...nova, valor: "0,00" })).toEqual({
      ok: false,
      erro: "Informe um valor maior que zero.",
    });
    expect(await criarContaReceber({ ...nova, valor: "abc" })).toMatchObject({ ok: false });
    expect(await criarContaReceber({ ...nova, clienteId: "" })).toEqual({
      ok: false,
      erro: "Escolha a cliente.",
    });
    expect(await criarContaReceber({ ...nova, vencimento: "2026-02-30" })).toEqual({
      ok: false,
      erro: "Informe uma data válida.",
    });
    expect(falso.chamadas).toHaveLength(0);
  });

  it("traduz 23514 do banco", async () => {
    falso.responder("rpc:criar_conta_receber", falha("23514", "check"));
    expect(await criarContaReceber(nova)).toEqual({ ok: false, erro: "Verifique os dados da conta." });
  });
});
