import { beforeEach, describe, expect, it, vi } from "vitest";
import { criarSupabaseFalso, type Resposta } from "@/test/supabase-falso";

let falso = criarSupabaseFalso();
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => falso.cliente }));
const verificarTurnstile = vi.fn<(token: string, ip: string | null) => Promise<boolean>>();
vi.mock("@/lib/online/turnstile", () => ({
  verificarTurnstile: (t: string, ip: string | null) => verificarTurnstile(t, ip),
}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" }),
}));

import { ipHash } from "@/lib/online/ip";
import { buscarHorarios, enviarPedido } from "./actions";

const SERVICO = "d3333333-3333-4333-8333-333333333333";
const PROF = "b2222222-2222-4222-8222-222222222222";
const PEDIDO = "a0000000-0000-4000-8000-0000000000a1";
const ok = (data: unknown): Resposta => ({ data, error: null });

const pedido = {
  servicoId: SERVICO,
  profissionalId: null,
  inicio: "2026-11-10T13:00:00.000Z",
  nome: "Maria Silva",
  whatsapp: "(11) 9 8765-4321",
  aceite: true as const,
  token: "tok",
};

beforeEach(() => {
  falso = criarSupabaseFalso();
  verificarTurnstile.mockReset();
  verificarTurnstile.mockResolvedValue(true);
});

describe("buscarHorarios", () => {
  it("recusa servicoId inválido sem chamar o banco", async () => {
    const r = await buscarHorarios({ servicoId: "x", profissionalId: null, dia: "2026-11-10" });
    expect(r.ok).toBe(false);
    expect(falso.chamadas).toHaveLength(0);
  });

  it("recusa dia inválido sem chamar o banco", async () => {
    const r = await buscarHorarios({ servicoId: SERVICO, profissionalId: null, dia: "10/11" });
    expect(r.ok).toBe(false);
    expect(falso.chamadas).toHaveLength(0);
  });

  it("devolve só inicio", async () => {
    falso.responder(
      "rpc:horarios_livres_online",
      ok([
        { inicio: "2026-11-10T12:00:00+00:00", profissional_id: PROF },
        { inicio: "2026-11-10T12:15:00+00:00", profissional_id: PROF },
      ]),
    );
    const r = await buscarHorarios({ servicoId: SERVICO, profissionalId: PROF, dia: "2026-11-10" });
    expect(r).toEqual({
      ok: true,
      horarios: [{ inicio: "2026-11-10T12:00:00+00:00" }, { inicio: "2026-11-10T12:15:00+00:00" }],
    });
    expect(falso.chamadasRpc("horarios_livres_online")[0].args[0]).toEqual({
      p_servico: SERVICO,
      p_profissional: PROF,
      p_dia: "2026-11-10",
    });
  });

  it("erro do banco vira mensagem amigável", async () => {
    falso.responder("rpc:horarios_livres_online", {
      data: null,
      error: { code: "XX000", message: "interno" },
    });
    const r = await buscarHorarios({ servicoId: SERVICO, profissionalId: null, dia: "2026-11-10" });
    expect(r).toEqual({ ok: false, erro: "Não foi possível concluir. Tente novamente." });
  });
});

describe("enviarPedido", () => {
  it("recusa sem aceite sem chamar o banco", async () => {
    const r = await enviarPedido({ ...pedido, aceite: false as unknown as true });
    expect(r).toEqual({ ok: false, erro: "Aceite o aviso de privacidade para continuar." });
    expect(falso.chamadas).toHaveLength(0);
    expect(verificarTurnstile).not.toHaveBeenCalled();
  });

  it('Turnstile falso → "Não foi possível confirmar que você não é um robô." sem chamar o banco', async () => {
    verificarTurnstile.mockResolvedValue(false);
    const r = await enviarPedido(pedido);
    expect(r).toEqual({ ok: false, erro: "Não foi possível confirmar que você não é um robô." });
    expect(falso.chamadas).toHaveLength(0);
    expect(verificarTurnstile).toHaveBeenCalledWith("tok", "203.0.113.7");
  });

  it("envia whatsapp normalizado e ip_hash", async () => {
    falso.responder("rpc:criar_pedido_online", ok(PEDIDO));
    falso.responder(
      "pedidos_online",
      ok({
        inicio: "2026-11-10T13:00:00+00:00",
        avaliacao: false,
        servicos: { nome: "Limpeza de pele" },
        profissional: { nome: "Ana Paula Souza" },
      }),
    );
    const r = await enviarPedido(pedido);
    const args = falso.chamadasRpc("criar_pedido_online")[0].args[0];
    expect(args).toEqual({
      p_servico: SERVICO,
      p_profissional: null,
      p_inicio: "2026-11-10T13:00:00.000Z",
      p_nome: "Maria Silva",
      p_whatsapp: "5511987654321",
      p_ip_hash: ipHash(new Headers({ "x-forwarded-for": "203.0.113.7" })),
    });
    expect(r).toEqual({
      ok: true,
      resumo: {
        servico: "Limpeza de pele",
        profissional: "Ana",
        inicio: "2026-11-10T13:00:00+00:00",
      },
    });
    expect(falso.chamadasDe("pedidos_online", "eq")[0].args).toEqual(["id", PEDIDO]);
  });

  it("resumo de serviço com avaliação", async () => {
    falso.responder("rpc:criar_pedido_online", ok(PEDIDO));
    falso.responder(
      "pedidos_online",
      ok({
        inicio: "2026-11-10T13:00:00+00:00",
        avaliacao: true,
        servicos: { nome: "Botox" },
        profissional: { nome: "Ana" },
      }),
    );
    const r = await enviarPedido(pedido);
    expect(r.ok && r.resumo.servico).toBe("Avaliação de Botox");
  });

  it("falha ao ler de volta: resumo usa os nomes do formulário", async () => {
    falso.responder("rpc:criar_pedido_online", ok(PEDIDO));
    falso.responder("pedidos_online", { data: null, error: { message: "falhou" } });
    const r = await enviarPedido({
      ...pedido,
      servicoNome: "Limpeza de pele",
      profissionalNome: "Ana",
    });
    expect(r).toEqual({
      ok: true,
      resumo: { servico: "Limpeza de pele", profissional: "Ana", inicio: pedido.inicio },
    });
    // Nomes do formulário nunca vão ao banco.
    expect(falso.chamadasRpc("criar_pedido_online")[0].args[0]).not.toHaveProperty("servicoNome");
  });

  it("falha ao ler de volta sem nomes do formulário: \"—\", nunca em branco", async () => {
    falso.responder("rpc:criar_pedido_online", ok(PEDIDO));
    falso.responder("pedidos_online", ok(null));
    const r = await enviarPedido({ ...pedido, servicoNome: "   " });
    expect(r).toEqual({
      ok: true,
      resumo: { servico: "—", profissional: "—", inicio: pedido.inicio },
    });
  });

  it("P0001 do banco vira a mensagem do banco", async () => {
    falso.responder("rpc:criar_pedido_online", {
      data: null,
      error: {
        code: "P0001",
        message: "Você já tem 3 pedidos aguardando resposta. Aguarde o retorno da clínica.",
      },
    });
    const r = await enviarPedido(pedido);
    expect(r).toEqual({
      ok: false,
      erro: "Você já tem 3 pedidos aguardando resposta. Aguarde o retorno da clínica.",
    });
  });

  it('23P01 da constraint → "Esse horário acabou de ser reservado, escolha outro."', async () => {
    falso.responder("rpc:criar_pedido_online", {
      data: null,
      error: {
        code: "23P01",
        message:
          'conflicting key value violates exclusion constraint "pedidos_online_sem_sobreposicao"',
      },
    });
    const r = await enviarPedido(pedido);
    expect(r).toEqual({ ok: false, erro: "Esse horário acabou de ser reservado, escolha outro." });
  });
});
