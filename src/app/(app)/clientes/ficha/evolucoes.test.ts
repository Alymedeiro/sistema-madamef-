import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Perfil } from "@/lib/dominio/permissoes";
import { criarSupabaseFalso } from "@/test/supabase-falso";

let perfilAtual: Perfil | null = "profissional";
const exigirPerfil = vi.fn(async (...perfis: Perfil[]) => {
  if (!perfilAtual) throw new Error("REDIRECT:/login");
  if (perfis.length > 0 && !perfis.includes(perfilAtual)) throw new Error("REDIRECT:/inicio");
  return { userId: "u1", colaborador: { id: PROF, nome: "Teste", perfil: perfilAtual } };
});
vi.mock("@/lib/sessao", () => ({ exigirPerfil: (...p: Perfil[]) => exigirPerfil(...p) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("server-only", () => ({}));

let falso = criarSupabaseFalso();
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => falso.cliente }));

import { carregarEvolucoes } from "./dados";
import type { Supabase } from "@/lib/ficha/acesso";
import { adicionarEvolucao, editarEvolucao, evolucoesDoAtendimento } from "./evolucoes";

const PROF = "5b0c1d52-3c4e-4f6a-8b7d-1a2b3c4d5e6f";
const AG = "6c1d2e63-4d5f-4a7b-9c8e-2b3c4d5e6f70";
const CL = "7d2e3f74-5e60-4b8c-8d9f-3c4d5e6f7081";
const EV = "8e3f4085-6f71-4c9d-9eaf-4d5e6f708192";

beforeEach(() => {
  perfilAtual = "profissional";
  falso = criarSupabaseFalso();
  exigirPerfil.mockClear();
});

describe("adicionarEvolucao", () => {
  it.each(["recepcao", "dona"] as const)("%s é redirecionada", async (p) => {
    perfilAtual = p;
    await expect(adicionarEvolucao(AG, "texto")).rejects.toThrow("REDIRECT:/inicio");
    expect(falso.chamadasDe("evolucoes", "insert")).toHaveLength(0);
  });

  it("recusa texto vazio, longo e id inválido sem inserir", async () => {
    expect(await adicionarEvolucao(AG, "  ")).toEqual({ ok: false, erro: "Escreva a evolução." });
    expect(await adicionarEvolucao(AG, "a".repeat(5001))).toEqual({
      ok: false,
      erro: "A evolução pode ter no máximo 5000 caracteres.",
    });
    expect((await adicionarEvolucao("x", "ok")).ok).toBe(false);
    expect(falso.chamadasDe("evolucoes", "insert")).toHaveLength(0);
  });

  it("atendimento inexistente ou de outra profissional", async () => {
    falso.responder("agendamentos", { data: null, error: null });
    expect(await adicionarEvolucao(AG, "ok")).toEqual({
      ok: false,
      erro: "Atendimento não encontrado.",
    });
    falso.responder("agendamentos", {
      data: { cliente_id: CL, profissional_id: "outra" },
      error: null,
    });
    expect(await adicionarEvolucao(AG, "ok")).toEqual({
      ok: false,
      erro: "Atendimento não encontrado.",
    });
    expect(falso.chamadasDe("evolucoes", "insert")).toHaveLength(0);
  });

  it("insere com cliente do agendamento e texto aparado, sem profissional nem datas do cliente", async () => {
    falso.responder("agendamentos", {
      data: { cliente_id: CL, profissional_id: PROF },
      error: null,
    });
    falso.responder("evolucoes", { data: { id: EV }, error: null });
    expect(await adicionarEvolucao(AG, "  Pele ótima  ")).toEqual({ ok: true, id: EV });
    expect(falso.chamadasDe("evolucoes", "insert")[0].args[0]).toEqual({
      agendamento_id: AG,
      cliente_id: CL,
      texto: "Pele ótima",
    });
  });

  it("erro do banco vira mensagem", async () => {
    falso.responder("agendamentos", {
      data: { cliente_id: CL, profissional_id: PROF },
      error: null,
    });
    falso.responder("evolucoes", { data: null, error: { code: "42501", message: "rls" } });
    expect(await adicionarEvolucao(AG, "ok")).toEqual({
      ok: false,
      erro: "Você não tem permissão para esta ação.",
    });
  });
});

describe("editarEvolucao", () => {
  it("recepção redirecionada; texto vazio recusado", async () => {
    perfilAtual = "recepcao";
    await expect(editarEvolucao(EV, "x")).rejects.toThrow("REDIRECT:/inicio");
    perfilAtual = "profissional";
    expect(await editarEvolucao(EV, " ")).toEqual({ ok: false, erro: "Escreva a evolução." });
    expect(falso.chamadasDe("evolucoes", "update")).toHaveLength(0);
  });

  it("atualiza só o texto, restrito à autora", async () => {
    falso.responder("evolucoes", { data: [{ id: EV }], error: null });
    expect(await editarEvolucao(EV, " novo ")).toEqual({ ok: true });
    expect(falso.chamadasDe("evolucoes", "update")[0].args[0]).toEqual({ texto: "novo" });
    expect(falso.chamadasDe("evolucoes", "eq").map((c) => c.args)).toEqual(
      expect.arrayContaining([
        ["id", EV],
        ["profissional_id", PROF],
      ]),
    );
  });

  it("0 linhas: não encontrada", async () => {
    falso.responder("evolucoes", { data: [], error: null });
    expect(await editarEvolucao(EV, "x")).toEqual({ ok: false, erro: "Evolução não encontrada." });
  });

  it("repassa a mensagem P0001 do banco", async () => {
    const msg = "A evolução só pode ser editada pela autora em até 24 horas";
    falso.responder("evolucoes", { data: null, error: { code: "P0001", message: msg } });
    expect(await editarEvolucao(EV, "x")).toEqual({ ok: false, erro: msg });
  });
});

describe("evolucoesDoAtendimento", () => {
  it("registra o acesso antes de ler as evoluções e marca editável", async () => {
    perfilAtual = "dona";
    falso.responder("agendamentos", { data: { cliente_id: CL }, error: null });
    falso.responder("evolucoes", {
      data: [
        {
          id: EV,
          texto: "t",
          criado_em: new Date().toISOString(),
          profissional_id: PROF,
          colaboradores: { nome: "Ana" },
        },
      ],
      error: null,
    });
    const r = await evolucoesDoAtendimento(AG);
    expect(r).toEqual({
      ok: true,
      evolucoes: [{ id: EV, texto: "t", criadoEm: expect.any(String), profissionalNome: "Ana", editavel: false }],
    });
    expect(falso.chamadasRpc("registrar_acesso")[0].args[0]).toEqual({
      p_entidade: "evolucoes",
      p_entidade_id: null,
      p_cliente: CL,
    });
    const ordem = falso.chamadas.map((c) => c.tabela);
    expect(ordem.indexOf("rpc:registrar_acesso")).toBeLessThan(ordem.indexOf("evolucoes"));
  });

  it("falha ao registrar acesso: nada é entregue", async () => {
    falso.responder("agendamentos", { data: { cliente_id: CL }, error: null });
    falso.responder("rpc:registrar_acesso", { data: null, error: { message: "x" } });
    const r = await evolucoesDoAtendimento(AG);
    expect(r.ok).toBe(false);
    expect(falso.chamadasDe("evolucoes")).toHaveLength(0);
  });

  it("atendimento não encontrado", async () => {
    falso.responder("agendamentos", { data: null, error: null });
    expect(await evolucoesDoAtendimento(AG)).toEqual({
      ok: false,
      erro: "Atendimento não encontrado.",
    });
  });
});

describe("carregarEvolucoes", () => {
  it("audita antes de ler, mais recente primeiro, editável só da autora dentro de 24 h", async () => {
    const agora = new Date("2026-11-04T12:00:00Z");
    const linha = (id: string, prof: string, criado: string) => ({
      id,
      texto: "t",
      criado_em: criado,
      profissional_id: prof,
      colaboradores: { nome: "Ana" },
      agendamentos: { inicio: "2026-11-03T13:00:00Z", servicos: { nome: "Limpeza" } },
    });
    falso.responder("evolucoes", {
      data: [
        linha("a", PROF, "2026-11-04T10:00:00Z"),
        linha("b", "outra", "2026-11-04T10:00:00Z"),
        linha("c", PROF, "2026-11-01T10:00:00Z"),
      ],
      error: null,
    });
    const r = await carregarEvolucoes(falso.cliente as unknown as Supabase, CL, PROF, agora);
    expect(r.map((e) => e.editavel)).toEqual([true, false, false]);
    expect(r[0].servicoNome).toBe("Limpeza");
    expect(falso.chamadasRpc("registrar_acesso")[0].args[0]).toMatchObject({
      p_entidade: "evolucoes",
      p_cliente: CL,
    });
    expect(falso.chamadasDe("evolucoes", "order")[0].args).toEqual([
      "criado_em",
      { ascending: false },
    ]);
    const ordem = falso.chamadas.map((c) => c.tabela);
    expect(ordem.indexOf("rpc:registrar_acesso")).toBeLessThan(ordem.indexOf("evolucoes"));
  });
});
