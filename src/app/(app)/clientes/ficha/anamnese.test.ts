import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Perfil } from "@/lib/dominio/permissoes";
import type { Pergunta } from "@/lib/dominio/anamnese";
import { criarSupabaseFalso } from "@/test/supabase-falso";

let perfilAtual: Perfil | null = "recepcao";
const exigirPerfil = vi.fn(async (...perfis: Perfil[]) => {
  if (!perfilAtual) throw new Error("REDIRECT:/login");
  if (perfis.length > 0 && !perfis.includes(perfilAtual)) throw new Error("REDIRECT:/inicio");
  return { userId: "u1", colaborador: { id: "c1", nome: "Teste", perfil: perfilAtual } };
});
vi.mock("@/lib/sessao", () => ({ exigirPerfil: (...p: Perfil[]) => exigirPerfil(...p) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("server-only", () => ({}));

let falso = criarSupabaseFalso();
let admin = criarSupabaseFalso();
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => falso.cliente }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => admin.cliente }));

import { registrarAnamnese, urlAssinaturaAnamnese } from "./anamnese";
import { carregarAlertasCabecalho, carregarAnamneses, carregarCabecalhoFicha } from "./dados";
import type { Supabase } from "@/lib/ficha/acesso";

const C = "5b0c1d52-3c4e-4f6a-8b7d-1a2b3c4d5e6f";
const M = "6c1d2e63-4d5f-4a7b-9c8e-2b3c4d5e6f70";
const PNG = "data:image/png;base64," + Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]).toString("base64");
const P: Pergunta[] = [
  { id: "queixa", tipo: "texto", texto: "Queixa?", obrigatoria: true, alerta: false },
  { id: "gestante", tipo: "sim_nao", texto: "Está grávida ou amamentando?", obrigatoria: true, alerta: true },
];
const modelo = { id: M, versao: 3, ativo: true, perguntas: P };
const respostas = { queixa: "Manchas", gestante: false };
const dados = { clienteId: C, modeloId: M, respostas, assinatura: PNG };

beforeEach(() => {
  perfilAtual = "recepcao";
  falso = criarSupabaseFalso();
  admin = criarSupabaseFalso();
  exigirPerfil.mockClear();
});

describe("registrarAnamnese", () => {
  it("sobe a assinatura pelo admin e depois grava a anamnese com o cliente da usuária", async () => {
    falso.responder("modelos_anamnese", { data: modelo, error: null });
    falso.responder("anamneses", { data: null, error: null });
    const r = await registrarAnamnese(dados);
    expect(r.ok).toBe(true);
    expect(exigirPerfil).toHaveBeenCalledWith("dona", "recepcao");
    const up = admin.chamadasDe("storage:ficha-clinica", "upload");
    expect(up).toHaveLength(1);
    const path = up[0].args[0] as string;
    expect(path).toMatch(new RegExp(`^clientes/${C}/anamneses/[0-9a-f-]{36}\\.png$`));
    expect(up[0].args[2]).toEqual({ contentType: "image/png", upsert: false });
    const ins = falso.chamadasDe("anamneses", "insert")[0].args[0] as Record<string, unknown>;
    expect(ins).toMatchObject({
      cliente_id: C,
      modelo_id: M,
      modelo_versao: 3,
      assinatura_path: path,
      respostas,
    });
    expect(path).toContain(ins.id as string);
    if (r.ok) expect(r.id).toBe(ins.id);
    expect(admin.chamadasDe("storage:ficha-clinica", "remove")).toHaveLength(0);
  });

  it("obrigatória faltando: erro e nenhuma chamada de storage", async () => {
    falso.responder("modelos_anamnese", { data: modelo, error: null });
    const r = await registrarAnamnese({ ...dados, respostas: { queixa: "Manchas" } });
    expect(r).toEqual({ ok: false, erro: "Responda: Está grávida ou amamentando?" });
    expect(admin.chamadas).toHaveLength(0);
    expect(falso.chamadasDe("anamneses")).toHaveLength(0);
  });

  it("modelo que não está mais ativo", async () => {
    falso.responder("modelos_anamnese", { data: { ...modelo, ativo: false }, error: null });
    expect(await registrarAnamnese(dados)).toEqual({
      ok: false,
      erro: "O modelo de anamnese mudou. Recomece o preenchimento.",
    });
    falso.responder("modelos_anamnese", { data: null, error: null });
    expect((await registrarAnamnese(dados)).ok).toBe(false);
    expect(admin.chamadas).toHaveLength(0);
  });

  it("assinatura inválida", async () => {
    falso.responder("modelos_anamnese", { data: modelo, error: null });
    expect(await registrarAnamnese({ ...dados, assinatura: "data:image/png;base64,AAAA" })).toEqual({
      ok: false,
      erro: "Assine no quadro antes de confirmar.",
    });
    expect(admin.chamadas).toHaveLength(0);
  });

  it("insert recusado: remove o arquivo e traduz o erro", async () => {
    falso.responder("modelos_anamnese", { data: modelo, error: null });
    falso.responder("anamneses", { data: null, error: { code: "42501", message: "rls" } });
    const r = await registrarAnamnese(dados);
    expect(r).toEqual({ ok: false, erro: "Você não tem permissão para esta ação." });
    const path = admin.chamadasDe("storage:ficha-clinica", "upload")[0].args[0];
    expect(admin.chamadasDe("storage:ficha-clinica", "remove")[0].args[0]).toEqual([path]);
  });

  it("profissional é redirecionada", async () => {
    perfilAtual = "profissional";
    await expect(registrarAnamnese(dados)).rejects.toThrow("REDIRECT:/inicio");
    expect(falso.chamadas).toHaveLength(0);
  });
});

describe("urlAssinaturaAnamnese", () => {
  const A = "7d2e3f74-5e60-4b8c-8d9f-3c4d5e6f7081";
  const path = `clientes/${C}/anamneses/${A}.png`;

  it("select, depois registrar_acesso, depois URL de 300 s", async () => {
    falso.responder("anamneses", { data: { id: A, cliente_id: C, assinatura_path: path }, error: null });
    falso.responder("rpc:registrar_acesso", { data: null, error: null });
    const r = await urlAssinaturaAnamnese(A);
    expect(r).toEqual({ ok: true, url: `https://assinada/${path}` });
    const ordem = falso.chamadas
      .map((c) => c.tabela)
      .filter((t, i, todas) => t !== todas[i - 1]);
    expect(ordem).toEqual(["anamneses", "rpc:registrar_acesso", "storage:ficha-clinica"]);
    expect(falso.chamadasRpc("registrar_acesso")[0].args[0]).toEqual({
      p_entidade: "anamneses",
      p_entidade_id: A,
      p_cliente: C,
    });
    expect(falso.chamadasDe("storage:ficha-clinica", "createSignedUrl")[0].args).toEqual([path, 300]);
  });

  it("falha ao registrar o acesso: nada é entregue", async () => {
    falso.responder("anamneses", { data: { id: A, cliente_id: C, assinatura_path: path }, error: null });
    falso.responder("rpc:registrar_acesso", { data: null, error: { code: "P0001", message: "x" } });
    expect((await urlAssinaturaAnamnese(A)).ok).toBe(false);
    expect(falso.chamadasDe("storage:ficha-clinica")).toHaveLength(0);
  });

  it("não encontrada pelo RLS", async () => {
    falso.responder("anamneses", { data: null, error: null });
    expect(await urlAssinaturaAnamnese(A)).toEqual({ ok: false, erro: "Anamnese não encontrada." });
  });
});

describe("dados da ficha", () => {
  it("carregarAnamneses registra o acesso antes do select", async () => {
    falso.responder("anamneses", { data: [], error: null });
    await carregarAnamneses(falso.cliente as unknown as Supabase, C);
    expect(falso.chamadas[0].tabela).toBe("rpc:registrar_acesso");
    expect(falso.chamadas[1].tabela).toBe("anamneses");
  });

  it("carregarAnamneses monta itens com as perguntas da própria versão", async () => {
    falso.responder("anamneses", {
      data: [
        {
          id: "a1",
          preenchida_em: "2026-10-01T12:00:00Z",
          modelo_versao: 1,
          respostas: { gestante: true },
          modelos_anamnese: { perguntas: P },
          colaboradores: { nome: "Dora" },
        },
      ],
      error: null,
    });
    const [a] = await carregarAnamneses(falso.cliente as unknown as Supabase, C);
    expect(a).toMatchObject({
      id: "a1",
      versao: 1,
      preenchidaPor: "Dora",
      alertas: ["Está grávida ou amamentando?"],
    });
    expect(a.itens[1]).toEqual({ pergunta: "Está grávida ou amamentando?", resposta: "Sim", alerta: true });
  });

  it("cabeçalho: só lê a anamnese quando há alerta", async () => {
    falso.responder("rpc:situacao_ficha", {
      data: [{ cliente_id: C, ultima_anamnese_em: "2026-10-01T12:00:00Z", tem_alerta: false }],
      error: null,
    });
    const r = await carregarAlertasCabecalho(falso.cliente as unknown as Supabase, C, new Date("2026-11-04T12:00:00Z"));
    expect(r).toEqual({ pendente: false, alertas: [] });
    expect(falso.chamadasRpc("registrar_acesso")).toHaveLength(0);

    falso.responder("rpc:situacao_ficha", {
      data: [{ cliente_id: C, ultima_anamnese_em: "2026-10-01T12:00:00Z", tem_alerta: true }],
      error: null,
    });
    falso.responder("anamneses", {
      data: { id: "a1", respostas: { gestante: true }, modelos_anamnese: { perguntas: P } },
      error: null,
    });
    const r2 = await carregarAlertasCabecalho(falso.cliente as unknown as Supabase, C, new Date("2026-11-04T12:00:00Z"));
    expect(r2.alertas).toEqual(["Está grávida ou amamentando?"]);
    expect(falso.chamadasRpc("registrar_acesso")[0].args[0]).toMatchObject({
      p_entidade: "anamneses",
      p_entidade_id: "a1",
    });
  });

  it("cabeçalho da página: falha vira { falhou: true } em vez de derrubar a ficha", async () => {
    const agora = new Date("2026-11-04T12:00:00Z");
    falso.responder("rpc:situacao_ficha", { data: null, error: { code: "XX000", message: "boom" } });
    expect(await carregarCabecalhoFicha(falso.cliente as unknown as Supabase, C, agora)).toEqual({
      falhou: true,
      pendente: false,
      alertas: [],
    });

    // Auditoria da leitura falhou: o alerta não é entregue.
    falso.responder("rpc:situacao_ficha", {
      data: [{ cliente_id: C, ultima_anamnese_em: "2026-10-01T12:00:00Z", tem_alerta: true }],
      error: null,
    });
    falso.responder("anamneses", {
      data: { id: "a1", respostas: { gestante: true }, modelos_anamnese: { perguntas: P } },
      error: null,
    });
    falso.responder("rpc:registrar_acesso", { data: null, error: { code: "P0001", message: "Acesso não autorizado" } });
    expect(await carregarCabecalhoFicha(falso.cliente as unknown as Supabase, C, agora)).toEqual({
      falhou: true,
      pendente: false,
      alertas: [],
    });

    falso.responder("rpc:situacao_ficha", {
      data: [{ cliente_id: C, ultima_anamnese_em: null, tem_alerta: false }],
      error: null,
    });
    expect(await carregarCabecalhoFicha(falso.cliente as unknown as Supabase, C, agora)).toEqual({
      falhou: false,
      pendente: true,
      alertas: [],
    });
  });
});
