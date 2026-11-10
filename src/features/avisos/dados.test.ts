import { describe, expect, it, vi } from "vitest";
import { criarSupabaseFalso } from "@/test/supabase-falso";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => null }));

import { carregarAvisos, carregarAvisosDoPerfil } from "./dados";
import { hrefConta } from "./link";

const ok = (data: unknown) => ({ data, error: null });
const HOJE = "2026-11-10";

function montar(opcoes: { pagar?: unknown[]; receber?: unknown[]; lidas?: unknown[] }) {
  const falso = criarSupabaseFalso();
  falso.responder("contas_pagar", ok(opcoes.pagar ?? []));
  falso.responder("contas_receber", ok(opcoes.receber ?? []));
  falso.responder("avisos_lidos", ok(opcoes.lidas ?? []));
  return falso;
}

const aluguel = { id: "p1", descricao: "Aluguel", valor_centavos: 350000, vencimento: "2026-11-13" };
const maria = {
  id: "r1",
  descricao: null,
  valor_centavos: 15000,
  vencimento: "2026-11-08",
  numero: 2,
  total_parcelas: 3,
  clientes: { nome: "Maria Silva" },
};

describe("carregarAvisos", () => {
  it("monta avisos de pagar e receber, ordenados por vencimento", async () => {
    const falso = montar({ pagar: [aluguel], receber: [maria] });
    const avisos = await carregarAvisos(falso.cliente as never, HOJE);
    expect(avisos.map((a) => a.chave)).toEqual([
      "receber:r1:vencida:2026-11-10",
      "pagar:p1:3",
    ]);
    expect(avisos[0].texto).toBe("vencida há 2 dias");
    expect(avisos[0].conta.nome).toBe("Maria Silva");
    expect(avisos[0].conta.parcela).toBe("parcela 2/3");
    expect(avisos[1].conta.nome).toBe("Aluguel");
  });

  it("consulta só contas em aberto com vencimento até hoje + 7", async () => {
    const falso = montar({});
    await carregarAvisos(falso.cliente as never, HOJE);
    const pagar = falso.chamadasDe("contas_pagar");
    expect(pagar).toContainEqual({ tabela: "contas_pagar", metodo: "eq", args: ["status", "aberta"] });
    expect(pagar).toContainEqual({ tabela: "contas_pagar", metodo: "lte", args: ["vencimento", "2026-11-17"] });
    const receber = falso.chamadasDe("contas_receber");
    expect(receber).toContainEqual({ tabela: "contas_receber", metodo: "is", args: ["recebido_em", null] });
    expect(receber).toContainEqual({ tabela: "contas_receber", metodo: "is", args: ["cancelada_em", null] });
    expect(receber).toContainEqual({ tabela: "contas_receber", metodo: "lte", args: ["vencimento", "2026-11-17"] });
  });

  it("aviso lido não volta; novo marco volta", async () => {
    const falso = montar({ pagar: [aluguel], lidas: [{ chave: "pagar:p1:3" }] });
    expect(await carregarAvisos(falso.cliente as never, HOJE)).toEqual([]);
    const amanha = montar({ pagar: [aluguel], lidas: [{ chave: "pagar:p1:3" }] });
    const avisos = await carregarAvisos(amanha.cliente as never, "2026-11-12");
    expect(avisos.map((a) => a.chave)).toEqual(["pagar:p1:1"]);
  });

  it("conta paga não aparece (o banco só devolve as em aberto)", async () => {
    const falso = montar({});
    expect(await carregarAvisos(falso.cliente as never, HOJE)).toEqual([]);
  });

  it("propaga erro de consulta", async () => {
    const falso = criarSupabaseFalso();
    falso.responder("contas_pagar", { data: null, error: { message: "x" } });
    falso.responder("contas_receber", ok([]));
    falso.responder("avisos_lidos", ok([]));
    await expect(carregarAvisos(falso.cliente as never, HOJE)).rejects.toThrow();
  });
});

describe("carregarAvisosDoPerfil", () => {
  it.each(["recepcao", "profissional"] as const)("não consulta nada para %s", async (perfil) => {
    const falso = montar({ pagar: [aluguel] });
    expect(await carregarAvisosDoPerfil(falso.cliente as never, HOJE, perfil)).toEqual([]);
    expect(falso.chamadas).toEqual([]);
  });

  it("dona recebe os avisos", async () => {
    const falso = montar({ pagar: [aluguel] });
    expect(await carregarAvisosDoPerfil(falso.cliente as never, HOJE, "dona")).toHaveLength(1);
  });

  it("falha vira lista vazia (o topo do app não quebra)", async () => {
    const falso = criarSupabaseFalso();
    falso.responder("contas_pagar", { data: null, error: { message: "x" } });
    expect(await carregarAvisosDoPerfil(falso.cliente as never, HOJE, "dona")).toEqual([]);
  });
});

describe("hrefConta", () => {
  it("vencida abre a situação Vencidas; a vencer, Em aberto em qualquer período", () => {
    expect(hrefConta("pagar", "p1", -2)).toBe("/financeiro?aba=pagar&conta=p1&situacao=vencida");
    expect(hrefConta("receber", "r1", 3)).toBe(
      "/financeiro?aba=receber&conta=r1&periodo=tudo&situacao=aberta",
    );
  });
});
