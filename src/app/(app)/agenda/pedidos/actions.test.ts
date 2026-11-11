import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Perfil } from "@/lib/dominio/permissoes";
import { mensagemAprovado, mensagemRecusado } from "@/lib/dominio/online";
import { criarSupabaseFalso, type Resposta } from "@/test/supabase-falso";

vi.mock("server-only", () => ({}));
let perfilAtual: Perfil | null = "recepcao";
const exigirPerfil = vi.fn(async (...perfis: Perfil[]) => {
  if (!perfilAtual) throw new Error("REDIRECT:/login");
  if (perfis.length > 0 && !perfis.includes(perfilAtual)) throw new Error("REDIRECT:/inicio");
  return { userId: "u1", colaborador: { id: "eu", nome: "Teste", perfil: perfilAtual } };
});
vi.mock("@/lib/sessao", () => ({ exigirPerfil: (...p: Perfil[]) => exigirPerfil(...p) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

let falso = criarSupabaseFalso();
const createClient = vi.fn(async () => falso.cliente);
vi.mock("@/lib/supabase/server", () => ({ createClient: () => createClient() }));

import { aprovarPedido, recusarPedido } from "./actions";

const PEDIDO = "a0000000-0000-4000-8000-0000000000a1";
const CLIENTE = "c1111111-1111-4111-8111-111111111111";
const NOVA = "c9999999-9999-4999-8999-999999999999";
const PROF = "b2222222-2222-4222-8222-222222222222";
const SERVICO = "d3333333-3333-4333-8333-333333333333";
const AG = "e4444444-4444-4444-8444-444444444444";
const ACEITE = "2026-11-08T10:00:00.000Z";

const ok = (data: unknown): Resposta => ({ data, error: null });

function prepararPedido(extra: Record<string, unknown> = {}) {
  falso.responder(
    "pedidos_online",
    ok({
      id: PEDIDO,
      status: "aguardando",
      servico_id: SERVICO,
      nome: "Maria Souza",
      whatsapp: "5511987654321",
      aceite_privacidade_em: ACEITE,
      criado_em: new Date(Date.now() - 3600_000).toISOString(),
      servicos: { nome: "Limpeza de pele" },
      ...extra,
    }),
  );
}

// 2026-11-03 é terça (dia_semana 2). Jornada 09–18. Primeiro colaboradores
// atende o nome da profissional; o segundo, a checagem de aprovarProposta.
function prepararContexto(jornada = true) {
  falso.responder("colaboradores", ok({ nome: "Fernanda" }));
  falso.responder("colaboradores", ok({ id: PROF, ativo: true }));
  falso.responder("servicos", ok({ id: SERVICO, duracao_min: 60, preco_centavos: 18000, ativo: true }));
  falso.responder("colaborador_servicos", ok([{ servico_id: SERVICO }]));
  falso.responder(
    "jornadas",
    ok(jornada ? [{ dia_semana: 2, hora_inicio: "09:00:00", hora_fim: "18:00:00" }] : []),
  );
  falso.responder("bloqueios_agenda", ok([]));
  falso.responder("agendamentos", ok([]));
}

const entrada = {
  pedidoId: PEDIDO,
  clienteId: CLIENTE as string | null,
  profissionalId: PROF,
  data: "2026-11-03",
  hora: "09:00",
};

beforeEach(() => {
  perfilAtual = "recepcao";
  falso = criarSupabaseFalso();
  exigirPerfil.mockClear();
  createClient.mockClear();
  process.env.NEXT_PUBLIC_SITE_URL = "https://clinica.exemplo";
});

describe("guarda de perfil", () => {
  it("profissional é negada e não toca no banco", async () => {
    perfilAtual = "profissional";
    await expect(aprovarPedido(entrada)).rejects.toThrow("REDIRECT:/inicio");
    await expect(recusarPedido({ pedidoId: PEDIDO })).rejects.toThrow("REDIRECT:/inicio");
    expect(exigirPerfil).toHaveBeenCalledWith("dona", "recepcao");
    expect(createClient).not.toHaveBeenCalled();
    expect(falso.chamadas).toHaveLength(0);
  });
});

describe("aprovarPedido", () => {
  it("com cliente existente chama a RPC com o valor do serviço e devolve o aviso", async () => {
    prepararPedido();
    prepararContexto();
    falso.responder("rpc:aprovar_pedido_online", ok(AG));
    falso.responder("fila_mensagens", ok([{ id: "f1" }]));

    const r = await aprovarPedido(entrada);

    expect(falso.chamadasRpc("aprovar_pedido_online")[0].args[0]).toEqual({
      p_pedido: PEDIDO,
      p_cliente: CLIENTE,
      p_profissional: PROF,
      p_inicio: "2026-11-03T12:00:00.000Z",
      p_fim: "2026-11-03T13:00:00.000Z",
      p_valor_centavos: 18000,
    });
    expect(falso.chamadasDe("clientes", "insert")).toHaveLength(0);
    const mensagem = mensagemAprovado({
      nome: "Maria Souza",
      servico: "Limpeza de pele",
      profissional: "Fernanda",
      inicio: new Date("2026-11-03T12:00:00.000Z"),
    });
    expect(r).toEqual({ ok: true, agendamentoId: AG, mensagem, link: expect.any(String), naFila: true });
    expect(falso.chamadasDe("fila_mensagens", "eq").map((c) => c.args)).toEqual([
      ["pedido_online_id", PEDIDO],
      ["tipo", "pedido_aprovado"],
    ]);
    if (!r.ok) throw new Error();
    expect(r.link.startsWith("https://wa.me/55")).toBe(true);
    expect(r.link).toContain(encodeURIComponent(mensagem));
  });

  it("sem cliente cria a cliente com o aceite LGPD do pedido e depois aprova", async () => {
    prepararPedido();
    prepararContexto();
    falso.responder("clientes", ok([]), ok({ id: NOVA }));
    falso.responder("rpc:aprovar_pedido_online", ok(AG));

    const r = await aprovarPedido({
      ...entrada,
      clienteId: null,
      novaCliente: { nome: "  Maria   Souza ", whatsapp: "(11) 9 8765-4321" },
    });

    expect(r.ok).toBe(true);
    const insert = falso.chamadasDe("clientes", "insert")[0].args[0];
    expect(insert).toEqual({
      nome: "Maria Souza",
      whatsapp: "5511987654321",
      aceite_lgpd_em: ACEITE,
    });
    const rpc = falso.chamadasRpc("aprovar_pedido_online")[0];
    expect((rpc.args[0] as { p_cliente: string }).p_cliente).toBe(NOVA);
    const indices = falso.chamadas;
    expect(indices.findIndex((c) => c.tabela === "clientes")).toBeLessThan(
      indices.findIndex((c) => c.tabela === "rpc:aprovar_pedido_online"),
    );
  });

  it("mesmo WhatsApp e mesmo nome (caixa/acentos/espaços) reaproveita a cliente", async () => {
    prepararPedido();
    prepararContexto();
    falso.responder("clientes", ok([{ id: CLIENTE, nome: "Márcia  Souza" }]));
    falso.responder("rpc:aprovar_pedido_online", ok(AG));
    const r = await aprovarPedido({
      ...entrada,
      clienteId: null,
      novaCliente: { nome: " marcia SOUZA ", whatsapp: "11987654321" },
    });
    expect(r.ok).toBe(true);
    expect(falso.chamadasDe("clientes", "eq")[0].args).toEqual(["whatsapp", "5511987654321"]);
    expect(falso.chamadasDe("clientes", "insert")).toHaveLength(0);
    expect(
      (falso.chamadasRpc("aprovar_pedido_online")[0].args[0] as { p_cliente: string }).p_cliente,
    ).toBe(CLIENTE);
  });

  it("mesmo WhatsApp com outro nome cadastra cliente nova", async () => {
    prepararPedido();
    prepararContexto();
    falso.responder("clientes", ok([{ id: CLIENTE, nome: "Maria Souza" }]), ok({ id: NOVA }));
    falso.responder("rpc:aprovar_pedido_online", ok(AG));
    const r = await aprovarPedido({
      ...entrada,
      clienteId: null,
      novaCliente: { nome: "Ana Souza", whatsapp: "11987654321" },
    });
    expect(r.ok).toBe(true);
    expect(falso.chamadasDe("clientes", "insert")).toHaveLength(1);
    expect(falso.chamadasDe("clientes", "insert")[0].args[0]).toMatchObject({ nome: "Ana Souza" });
    expect(
      (falso.chamadasRpc("aprovar_pedido_online")[0].args[0] as { p_cliente: string }).p_cliente,
    ).toBe(NOVA);
  });

  it("RPC falha depois de cadastrar: devolve clienteId e repetir não insere de novo", async () => {
    const nova = { nome: "Maria Souza", whatsapp: "(11) 98765-4321" };
    prepararPedido();
    prepararContexto();
    falso.responder("clientes", ok([]), ok({ id: NOVA }));
    falso.responder("rpc:aprovar_pedido_online", {
      data: null,
      error: {
        code: "P0001",
        message: "Há um pedido online neste horário. Aprove ou recuse o pedido primeiro.",
      },
    });
    const r1 = await aprovarPedido({ ...entrada, clienteId: null, novaCliente: nova });
    expect(r1).toEqual({
      ok: false,
      erro: "Há um pedido online neste horário. Aprove ou recuse o pedido primeiro.",
      clienteId: NOVA,
    });
    expect(falso.chamadasDe("clientes", "insert")).toHaveLength(1);

    // Repetição com "nova" ainda marcada (ou outra recepcionista): acha pelo WhatsApp.
    prepararPedido();
    prepararContexto();
    falso.responder("clientes", ok([{ id: NOVA, nome: "Maria Souza" }]));
    falso.responder("rpc:aprovar_pedido_online", ok(AG));
    const r2 = await aprovarPedido({ ...entrada, clienteId: null, novaCliente: nova });
    expect(r2.ok).toBe(true);
    expect(falso.chamadasDe("clientes", "insert")).toHaveLength(1);
    const rpcs = falso.chamadasRpc("aprovar_pedido_online");
    expect((rpcs[1].args[0] as { p_cliente: string }).p_cliente).toBe(NOVA);
  });

  it("RPC falha com cliente escolhida: erro sem clienteId", async () => {
    prepararPedido();
    prepararContexto();
    falso.responder("rpc:aprovar_pedido_online", {
      data: null,
      error: { code: "23P01", message: "x" },
    });
    expect(await aprovarPedido(entrada)).toEqual({
      ok: false,
      erro: "Este horário já está ocupado para esta profissional.",
    });
  });

  it("pedido aguardando com mais de 24 h sai cedo sem validar nem chamar a RPC", async () => {
    prepararPedido({ criado_em: new Date(Date.now() - 25 * 3600_000).toISOString() });
    falso.responder("colaboradores", ok({ nome: "Fernanda" }));
    expect(await aprovarPedido(entrada)).toEqual({
      ok: false,
      erro: "Este pedido já foi respondido.",
    });
    expect(falso.chamadasRpc("aprovar_pedido_online")).toHaveLength(0);
    expect(falso.chamadasDe("jornadas")).toHaveLength(0);
  });

  it("sem cliente e sem cadastro devolve erro sem tocar no banco", async () => {
    const r = await aprovarPedido({ ...entrada, clienteId: null });
    expect(r).toEqual({ ok: false, erro: "Escolha a cliente ou cadastre uma nova." });
    expect(falso.chamadas).toHaveLength(0);
  });

  it("fora da jornada devolve o aviso e não chama a RPC nem cria cliente", async () => {
    prepararPedido();
    prepararContexto(false);
    const r = await aprovarPedido({
      ...entrada,
      clienteId: null,
      novaCliente: { nome: "Maria", whatsapp: "11987654321" },
    });
    expect(r).toEqual({
      ok: false,
      aviso: "fora_da_jornada",
      erro: "Fora do horário de trabalho da profissional. Deseja encaixar mesmo assim?",
    });
    expect(falso.chamadasRpc("aprovar_pedido_online")).toHaveLength(0);
    expect(falso.chamadasDe("clientes")).toHaveLength(0);
  });

  it("encaixe confirmado (forcarForaJornada) aprova", async () => {
    prepararPedido();
    prepararContexto(false);
    falso.responder("rpc:aprovar_pedido_online", ok(AG));
    const r = await aprovarPedido({ ...entrada, forcarForaJornada: true });
    expect(r.ok).toBe(true);
  });

  it("repassa 'Este pedido já foi respondido.' da RPC (duplo toque)", async () => {
    prepararPedido();
    prepararContexto();
    falso.responder("rpc:aprovar_pedido_online", {
      data: null,
      error: { code: "P0001", message: "Este pedido já foi respondido." },
    });
    expect(await aprovarPedido(entrada)).toEqual({
      ok: false,
      erro: "Este pedido já foi respondido.",
    });
  });

  it("pedido já respondido não valida nem chama a RPC", async () => {
    prepararPedido({ status: "aprovado" });
    falso.responder("colaboradores", ok({ nome: "Fernanda" }));
    expect(await aprovarPedido(entrada)).toEqual({
      ok: false,
      erro: "Este pedido já foi respondido.",
    });
    expect(falso.chamadasRpc("aprovar_pedido_online")).toHaveLength(0);
  });

  it("sobreposição na agenda (23P01) vira a mensagem da agenda", async () => {
    prepararPedido();
    prepararContexto();
    falso.responder("rpc:aprovar_pedido_online", {
      data: null,
      error: { code: "23P01", message: "agendamentos_sem_sobreposicao" },
    });
    expect(await aprovarPedido(entrada)).toEqual({
      ok: false,
      erro: "Este horário já está ocupado para esta profissional.",
    });
  });
});

describe("recusarPedido", () => {
  it("motivo com 201 caracteres é recusado sem tocar no banco", async () => {
    const r = await recusarPedido({ pedidoId: PEDIDO, motivo: "a".repeat(201) });
    expect(r).toEqual({ ok: false, erro: "O motivo pode ter no máximo 200 caracteres." });
    expect(falso.chamadas).toHaveLength(0);
  });

  it("sucesso chama a RPC e devolve o link com mensagemRecusado", async () => {
    prepararPedido();
    falso.responder("rpc:recusar_pedido_online", ok(null));
    falso.responder("fila_mensagens", ok([{ id: "f1" }]));
    const r = await recusarPedido({ pedidoId: PEDIDO, motivo: "  Agenda cheia " });

    expect(falso.chamadasRpc("recusar_pedido_online")[0].args[0]).toEqual({
      p_pedido: PEDIDO,
      p_motivo: "Agenda cheia",
    });
    const mensagem = mensagemRecusado({
      nome: "Maria Souza",
      servico: "Limpeza de pele",
      site: "https://clinica.exemplo",
    });
    expect(r).toEqual({ ok: true, mensagem, link: expect.any(String), naFila: true });
    if (!r.ok) throw new Error();
    expect(r.link.startsWith("https://wa.me/5511987654321")).toBe(true);
    expect(r.link).toContain(encodeURIComponent(mensagem));
  });

  it("número estrangeiro (o gatilho não enfileira) → naFila false: mantém o botão manual", async () => {
    prepararPedido({ whatsapp: "351912345678" });
    falso.responder("rpc:recusar_pedido_online", ok(null));
    falso.responder("fila_mensagens", ok([]));
    const r = await recusarPedido({ pedidoId: PEDIDO });
    expect(r).toMatchObject({ ok: true, naFila: false });
    if (!r.ok) throw new Error();
    expect(r.link.startsWith("https://wa.me/351912345678")).toBe(true);
    expect(falso.chamadasDe("fila_mensagens", "eq").map((c) => c.args)).toEqual([
      ["pedido_online_id", PEDIDO],
      ["tipo", "pedido_recusado"],
    ]);
  });

  it("erro ao consultar a fila → naFila false (na dúvida, botão manual)", async () => {
    prepararPedido();
    falso.responder("rpc:recusar_pedido_online", ok(null));
    falso.responder("fila_mensagens", { data: null, error: { message: "x" } });
    expect(await recusarPedido({ pedidoId: PEDIDO })).toMatchObject({ ok: true, naFila: false });
  });

  it("sem motivo envia null e repassa erro da RPC", async () => {
    prepararPedido();
    falso.responder("rpc:recusar_pedido_online", {
      data: null,
      error: { code: "P0001", message: "Este pedido já foi respondido." },
    });
    const r = await recusarPedido({ pedidoId: PEDIDO });
    expect((falso.chamadasRpc("recusar_pedido_online")[0].args[0] as { p_motivo: unknown }).p_motivo).toBeNull();
    expect(r).toEqual({ ok: false, erro: "Este pedido já foi respondido." });
  });
});
