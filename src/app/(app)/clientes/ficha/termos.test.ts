import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Perfil } from "@/lib/dominio/permissoes";
import { criarSupabaseFalso } from "@/test/supabase-falso";

let perfilAtual: Perfil | null = "profissional";
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

import { colherAssinaturaTermo, urlArquivoTermo } from "./termos";
import { carregarTermos } from "./dados";
import type { Supabase } from "@/lib/ficha/acesso";

const C = "5b0c1d52-3c4e-4f6a-8b7d-1a2b3c4d5e6f";
const M = "6c1d2e63-4d5f-4a7b-9c8e-2b3c4d5e6f70";
const AG = "9f4a5b96-7a82-4dae-8fb0-5e6f70819203";
const T = "7d2e3f74-5e60-4b8c-8d9f-3c4d5e6f7081";
const PNG_1x1 =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const UA =
  "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const cliente = { id: C, nome: "Ana Souza", cpf: "52998224725" };
const modelo = { id: M, titulo: "Termo Peeling", texto: "# Riscos\nVermelhidão.", versao: 2, ativo: true };
const dados = {
  clienteId: C,
  modeloTermoId: M,
  agendamentoId: AG as string | null,
  assinatura: PNG_1x1,
  dispositivo: UA,
  aceite: true,
};
const ok = (data: unknown) => ({ data, error: null });

beforeEach(() => {
  perfilAtual = "profissional";
  falso = criarSupabaseFalso();
  admin = criarSupabaseFalso();
  exigirPerfil.mockClear();
});

function prepararOk() {
  falso.responder("clientes", ok(cliente));
  falso.responder("modelos_termo", ok(modelo));
  falso.responder("agendamentos", ok({ id: AG }));
  falso.responder("termos_assinados", ok(null));
}

describe("colherAssinaturaTermo", () => {
  it("profissional: sobe PNG e PDF pelo admin e grava com o cliente da usuária", async () => {
    prepararOk();
    const r = await colherAssinaturaTermo(dados);
    expect(r.ok).toBe(true);
    expect(exigirPerfil).toHaveBeenCalledWith();

    const ups = admin.chamadasDe("storage:ficha-clinica", "upload");
    expect(ups).toHaveLength(2);
    const caminhos = ups.map((u) => u.args[0] as string);
    expect(caminhos.every((c) => new RegExp(`^clientes/${C}/termos/[0-9a-f-]{36}\\.(png|pdf)$`).test(c))).toBe(true);
    const png = caminhos.find((c) => c.endsWith(".png"))!;
    const pdf = caminhos.find((c) => c.endsWith(".pdf"))!;
    expect(ups.find((u) => u.args[0] === png)!.args[2]).toEqual({ contentType: "image/png", upsert: false });
    expect(ups.find((u) => u.args[0] === pdf)!.args[2]).toEqual({ contentType: "application/pdf", upsert: false });

    const ins = falso.chamadasDe("termos_assinados", "insert")[0].args[0] as Record<string, unknown>;
    expect(ins).toMatchObject({
      cliente_id: C,
      modelo_termo_id: M,
      modelo_versao: 2,
      agendamento_id: AG,
      assinatura_path: png,
      pdf_path: pdf,
      dispositivo: "iPad · Safari",
    });
    expect(ins.hash_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(pdf.endsWith(`${ins.id as string}.pdf`)).toBe(true);
    expect(png).not.toContain(ins.id as string);
    if (r.ok) expect(r.id).toBe(ins.id);
    expect(admin.chamadasDe("storage:ficha-clinica", "remove")).toHaveLength(0);
  });

  it("sem agendamento: não consulta agendamentos e grava null", async () => {
    falso.responder("clientes", ok(cliente));
    falso.responder("modelos_termo", ok(modelo));
    falso.responder("termos_assinados", ok(null));
    expect((await colherAssinaturaTermo({ ...dados, agendamentoId: null })).ok).toBe(true);
    expect(falso.chamadasDe("agendamentos")).toHaveLength(0);
    expect(falso.chamadasDe("termos_assinados", "insert")[0].args[0]).toMatchObject({ agendamento_id: null });
  });

  it("sem aceite: erro e nenhum upload", async () => {
    expect(await colherAssinaturaTermo({ ...dados, aceite: false })).toEqual({
      ok: false,
      erro: 'Marque "Li e concordo" para assinar.',
    });
    expect(admin.chamadas).toHaveLength(0);
    expect(falso.chamadas).toHaveLength(0);
  });

  it("assinatura inválida", async () => {
    expect(await colherAssinaturaTermo({ ...dados, assinatura: "data:image/png;base64,AAAA" })).toEqual({
      ok: false,
      erro: "Assine no quadro antes de confirmar.",
    });
    expect(admin.chamadas).toHaveLength(0);
  });

  it("cliente que o RLS não mostra: não encontrada, sem upload", async () => {
    falso.responder("clientes", ok(null));
    expect(await colherAssinaturaTermo(dados)).toEqual({ ok: false, erro: "Cliente não encontrada." });
    expect(admin.chamadas).toHaveLength(0);
  });

  it("modelo inativo ou ausente", async () => {
    const erro = "Este termo foi atualizado. Abra novamente para assinar a versão atual.";
    falso.responder("clientes", ok(cliente), ok(cliente));
    falso.responder("modelos_termo", ok({ ...modelo, ativo: false }), ok(null));
    expect(await colherAssinaturaTermo(dados)).toEqual({ ok: false, erro });
    expect(await colherAssinaturaTermo(dados)).toEqual({ ok: false, erro });
    expect(admin.chamadas).toHaveLength(0);
  });

  it("atendimento que não é da cliente", async () => {
    falso.responder("clientes", ok(cliente));
    falso.responder("modelos_termo", ok(modelo));
    falso.responder("agendamentos", ok(null));
    expect(await colherAssinaturaTermo(dados)).toEqual({ ok: false, erro: "Atendimento não encontrado." });
    expect(falso.chamadasDe("agendamentos", "eq").map((c) => c.args)).toContainEqual(["cliente_id", C]);
    expect(admin.chamadas).toHaveLength(0);
  });

  it("ids inválidos não tocam no banco", async () => {
    expect((await colherAssinaturaTermo({ ...dados, clienteId: "x" })).ok).toBe(false);
    expect((await colherAssinaturaTermo({ ...dados, modeloTermoId: "x" })).ok).toBe(false);
    expect(falso.chamadas).toHaveLength(0);
  });

  it("insert recusado: remove os dois arquivos e traduz o erro", async () => {
    falso.responder("clientes", ok(cliente));
    falso.responder("modelos_termo", ok(modelo));
    falso.responder("agendamentos", ok({ id: AG }));
    falso.responder("termos_assinados", { data: null, error: { code: "42501", message: "rls" } });
    expect(await colherAssinaturaTermo(dados)).toEqual({
      ok: false,
      erro: "Você não tem permissão para esta ação.",
    });
    const subidos = admin.chamadasDe("storage:ficha-clinica", "upload").map((u) => u.args[0]);
    const removidos = admin.chamadasDe("storage:ficha-clinica", "remove")[0].args[0] as string[];
    expect([...removidos].sort()).toEqual([...(subidos as string[])].sort());
    expect(removidos).toHaveLength(2);
  });

  it("falha no upload do PDF remove o PNG e não grava", async () => {
    falso.responder("clientes", ok(cliente));
    falso.responder("modelos_termo", ok(modelo));
    falso.responder("agendamentos", ok({ id: AG }));
    admin.responder("storage:ficha-clinica:upload", ok({ path: "x" }), { data: null, error: { message: "falhou" } });
    const r = await colherAssinaturaTermo(dados);
    expect(r.ok).toBe(false);
    expect(falso.chamadasDe("termos_assinados")).toHaveLength(0);
    expect(admin.chamadasDe("storage:ficha-clinica", "remove")[0].args[0]).toHaveLength(2);
  });
});

describe("urlArquivoTermo", () => {
  const pdf = `clientes/${C}/termos/${T}.pdf`;
  const ass = `clientes/${C}/termos/${M}.png`;
  const linha = { id: T, cliente_id: C, pdf_path: pdf, assinatura_path: ass };

  it("select, depois registrar_acesso, depois URL de 300 s", async () => {
    falso.responder("termos_assinados", ok(linha));
    falso.responder("rpc:registrar_acesso", ok(null));
    expect(await urlArquivoTermo(T, "pdf")).toEqual({ ok: true, url: `https://assinada/${pdf}` });
    const ordem = falso.chamadas.map((c) => c.tabela).filter((t, i, todas) => t !== todas[i - 1]);
    expect(ordem).toEqual(["termos_assinados", "rpc:registrar_acesso", "storage:ficha-clinica"]);
    expect(falso.chamadasRpc("registrar_acesso")[0].args[0]).toEqual({
      p_entidade: "termos_assinados",
      p_entidade_id: T,
      p_cliente: C,
    });
    expect(falso.chamadasDe("storage:ficha-clinica", "createSignedUrl")[0].args).toEqual([pdf, 300]);
  });

  it("assinatura usa o caminho do PNG", async () => {
    falso.responder("termos_assinados", ok(linha));
    falso.responder("rpc:registrar_acesso", ok(null));
    expect(await urlArquivoTermo(T, "assinatura")).toEqual({ ok: true, url: `https://assinada/${ass}` });
  });

  it("falha ao registrar o acesso: nada é entregue", async () => {
    falso.responder("termos_assinados", ok(linha));
    falso.responder("rpc:registrar_acesso", { data: null, error: { code: "P0001", message: "x" } });
    expect((await urlArquivoTermo(T, "pdf")).ok).toBe(false);
    expect(falso.chamadasDe("storage:ficha-clinica")).toHaveLength(0);
  });

  it("não encontrado pelo RLS ou id inválido", async () => {
    falso.responder("termos_assinados", ok(null));
    expect(await urlArquivoTermo(T, "pdf")).toEqual({ ok: false, erro: "Termo não encontrado." });
    expect(await urlArquivoTermo("x", "pdf")).toEqual({ ok: false, erro: "Termo não encontrado." });
  });
});

describe("carregarTermos", () => {
  const sb = () => falso.cliente as unknown as Supabase;

  it("registra o acesso antes de ler e separa assinados e pendentes", async () => {
    falso.responder("termos_assinados", ok([
      {
        id: T,
        assinado_em: "2026-10-01T12:00:00Z",
        modelo_versao: 1,
        modelo_termo_id: "m-velho",
        modelos_termo: { titulo: "Termo Peeling", ativo: false },
        colaboradores: { nome: "Dora" },
      },
      {
        id: "t2",
        assinado_em: "2026-09-01T12:00:00Z",
        modelo_versao: 1,
        modelo_termo_id: "m-lash",
        modelos_termo: { titulo: "Termo Lash", ativo: true },
        colaboradores: { nome: "Bia" },
      },
    ]));
    falso.responder("agendamentos", ok([
      { servicos: { modelo_termo_id: "m-lash", modelos_termo: { id: "m-lash", titulo: "Termo Lash" } } },
      { servicos: { modelo_termo_id: M, modelos_termo: { id: M, titulo: "Termo Peeling" } } },
      { servicos: { modelo_termo_id: M, modelos_termo: { id: M, titulo: "Termo Peeling" } } },
      { servicos: { modelo_termo_id: null, modelos_termo: null } },
    ]));
    const r = await carregarTermos(sb(), C);
    expect(falso.chamadas[0].tabela).toBe("rpc:registrar_acesso");
    expect(falso.chamadasRpc("registrar_acesso")[0].args[0]).toEqual({
      p_entidade: "termos_assinados",
      p_entidade_id: null,
      p_cliente: C,
    });
    expect(r.assinados).toEqual([
      { id: T, titulo: "Termo Peeling", versao: 1, assinadoEm: "2026-10-01T12:00:00Z", colhidoPor: "Dora", atual: false },
      { id: "t2", titulo: "Termo Lash", versao: 1, assinadoEm: "2026-09-01T12:00:00Z", colhidoPor: "Bia", atual: true },
    ]);
    expect(r.pendentes).toEqual([{ modeloTermoId: M, titulo: "Termo Peeling" }]);
  });
});
