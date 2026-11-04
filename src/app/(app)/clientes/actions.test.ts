import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Perfil } from "@/lib/dominio/permissoes";
import { criarSupabaseFalso } from "@/test/supabase-falso";

let perfilAtual: Perfil | null = "recepcao";
const exigirPerfil = vi.fn(async (...perfis: Perfil[]) => {
  if (!perfilAtual) throw new Error("REDIRECT:/login");
  if (perfis.length > 0 && !perfis.includes(perfilAtual)) throw new Error("REDIRECT:/inicio");
  return { userId: "u1", colaborador: { id: "c1", nome: "Teste", perfil: perfilAtual } };
});
vi.mock("@/lib/sessao", () => ({ exigirPerfil: (...p: Perfil[]) => exigirPerfil(...p) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

let falso = criarSupabaseFalso();
const createClient = vi.fn(async () => falso.cliente);
vi.mock("@/lib/supabase/server", () => ({ createClient: () => createClient() }));

import {
  atualizarCliente,
  buscarClientes,
  criarCliente,
  definirClienteAtivo,
} from "./actions";

const ID = "5b0c1d52-3c4e-4f6a-8b7d-1a2b3c4d5e6f";
const dados = {
  nome: "Ana",
  whatsapp: "(11) 98765-4321",
  cpf: "529.982.247-25",
  aceiteLgpd: true,
  aceitaWhatsappMarketing: true,
};
const { aceiteLgpd: _a, ...dadosEdicao } = dados;
void _a;

const ERRO_CPF_DUPLICADO = {
  code: "23505",
  message: 'duplicate key value violates unique constraint "clientes_cpf_key"',
};

beforeEach(() => {
  perfilAtual = "recepcao";
  falso = criarSupabaseFalso();
  exigirPerfil.mockClear();
  createClient.mockClear();
});

describe("guarda de perfil", () => {
  it("escritas exigem dona ou recepção e não tocam no banco para profissional", async () => {
    perfilAtual = "profissional";
    await expect(criarCliente(dados)).rejects.toThrow("REDIRECT:/inicio");
    await expect(atualizarCliente(ID, dadosEdicao)).rejects.toThrow("REDIRECT:/inicio");
    await expect(definirClienteAtivo(ID, false)).rejects.toThrow("REDIRECT:/inicio");
    expect(exigirPerfil).toHaveBeenCalledWith("dona", "recepcao");
    expect(createClient).not.toHaveBeenCalled();
    expect(falso.chamadas).toHaveLength(0);
  });

  it("buscarClientes é liberada para os três perfis (o RLS limita a profissional)", async () => {
    perfilAtual = "profissional";
    falso.responder("clientes", { data: [], error: null });
    await expect(buscarClientes("ana")).resolves.toEqual([]);
    expect(exigirPerfil).toHaveBeenCalledWith("dona", "recepcao", "profissional");
  });
});

describe("criarCliente", () => {
  it("grava CPF só com dígitos, WhatsApp normalizado e o aceite LGPD agora", async () => {
    falso.responder("clientes", { data: { id: ID }, error: null });
    const antes = Date.now();
    const r = await criarCliente(dados);
    expect(r).toEqual({ ok: true, id: ID });

    const linha = falso.chamadasDe("clientes", "insert")[0].args[0] as Record<string, unknown>;
    expect(linha.nome).toBe("Ana");
    expect(linha.cpf).toBe("52998224725");
    expect(linha.whatsapp).toBe("5511987654321");
    expect(linha.aceita_whatsapp_marketing).toBe(true);
    const aceite = new Date(linha.aceite_lgpd_em as string).getTime();
    expect(aceite).toBeGreaterThanOrEqual(antes - 1000);
    expect(aceite).toBeLessThanOrEqual(Date.now() + 1000);
  });

  it("grafias diferentes do mesmo CPF e telefone chegam ao banco idênticas", async () => {
    const variantes = [
      { whatsapp: "(11) 98765-4321", cpf: "529.982.247-25" },
      { whatsapp: "11987654321", cpf: "52998224725" },
      { whatsapp: "+55 11 98765-4321", cpf: " 529 982 247 25" },
    ];
    for (const v of variantes) {
      falso.responder("clientes", { data: { id: ID }, error: null });
      expect((await criarCliente({ ...dados, ...v })).ok).toBe(true);
    }
    const linhas = falso
      .chamadasDe("clientes", "insert")
      .map((c) => c.args[0] as Record<string, unknown>);
    expect(linhas).toHaveLength(3);
    for (const l of linhas) {
      expect(l.whatsapp).toBe("5511987654321");
      expect(l.cpf).toBe("52998224725");
    }
  });

  it("CPF repetido no banco vira a mensagem de cliente já cadastrada", async () => {
    falso.responder("clientes", { data: null, error: ERRO_CPF_DUPLICADO });
    expect(await criarCliente({ ...dados, cpf: "529.982.247-25" })).toEqual({
      ok: false,
      erro: "Já existe uma cliente cadastrada com este CPF.",
    });
  });

  it("valida sem tocar no banco (sem aceite, CPF inválido, WhatsApp sem DDD)", async () => {
    expect(await criarCliente({ ...dados, aceiteLgpd: false })).toEqual({
      ok: false,
      erro: "É preciso o aceite da cliente (LGPD)",
    });
    expect(await criarCliente({ ...dados, cpf: "111.111.111-11" })).toEqual({
      ok: false,
      erro: "CPF inválido",
    });
    expect(await criarCliente({ ...dados, whatsapp: "98765-4321" })).toEqual({
      ok: false,
      erro: "Informe o WhatsApp com DDD",
    });
    expect(falso.chamadas).toHaveLength(0);
  });
});

describe("atualizarCliente", () => {
  it("atualiza por id sem nunca mexer em aceite_lgpd_em", async () => {
    falso.responder("clientes", { data: [{ id: ID }], error: null });
    expect(await atualizarCliente(ID, dadosEdicao)).toEqual({ ok: true });
    const linha = falso.chamadasDe("clientes", "update")[0].args[0] as Record<string, unknown>;
    expect("aceite_lgpd_em" in linha).toBe(false);
    expect(linha.cpf).toBe("52998224725");
    expect(linha.whatsapp).toBe("5511987654321");
    expect(falso.chamadasDe("clientes", "eq")[0].args).toEqual(["id", ID]);
  });

  it("ignora um aceiteLgpd extra vindo do cliente", async () => {
    falso.responder("clientes", { data: [{ id: ID }], error: null });
    await atualizarCliente(ID, { ...dadosEdicao, aceiteLgpd: false } as never);
    const linha = falso.chamadasDe("clientes", "update")[0].args[0] as Record<string, unknown>;
    expect("aceite_lgpd_em" in linha).toBe(false);
    expect("aceiteLgpd" in linha).toBe(false);
  });

  it("CPF de outra cliente vira a mensagem de duplicado", async () => {
    falso.responder("clientes", { data: null, error: ERRO_CPF_DUPLICADO });
    expect(await atualizarCliente(ID, dadosEdicao)).toEqual({
      ok: false,
      erro: "Já existe uma cliente cadastrada com este CPF.",
    });
  });

  it("avisa se não encontrou e rejeita id inválido", async () => {
    falso.responder("clientes", { data: [], error: null });
    expect(await atualizarCliente(ID, dadosEdicao)).toEqual({
      ok: false,
      erro: "Cliente não encontrada.",
    });
    expect((await atualizarCliente("x", dadosEdicao)).ok).toBe(false);
  });
});

describe("definirClienteAtivo", () => {
  it("grava ativo e rejeita id inválido", async () => {
    expect(await definirClienteAtivo(ID, false)).toEqual({ ok: true });
    expect(falso.chamadasDe("clientes", "update")[0].args[0]).toEqual({ ativo: false });
    expect((await definirClienteAtivo("x", true)).ok).toBe(false);
  });
});

describe("buscarClientes", () => {
  it("menos de 2 caracteres devolve [] sem consultar", async () => {
    expect(await buscarClientes(" a ")).toEqual([]);
    expect(await buscarClientes("")).toEqual([]);
    expect(createClient).not.toHaveBeenCalled();
  });

  it("busca por nome sem acento, só ativas, ordenada, máx. 20", async () => {
    falso.responder("clientes", {
      data: [{ id: ID, nome: "Ana Conceição", whatsapp: "5511987654321", ativo: true }],
      error: null,
    });
    const r = await buscarClientes("  Ânã Conceição ");
    expect(r).toEqual([{ id: ID, nome: "Ana Conceição", whatsapp: "5511987654321" }]);
    expect(falso.chamadasDe("clientes", "ilike")[0].args).toEqual(["nome_busca", "%ana conceicao%"]);
    expect(falso.chamadasDe("clientes", "eq")[0].args).toEqual(["ativo", true]);
    expect(falso.chamadasDe("clientes", "order")[0].args[0]).toBe("nome");
    expect(falso.chamadasDe("clientes", "limit")[0].args).toEqual([20]);
  });

  it("escapa %, _ e contrabarra digitados", async () => {
    falso.responder("clientes", { data: [], error: null });
    await buscarClientes("a%_\\");
    expect(falso.chamadasDe("clientes", "ilike")[0].args).toEqual(["nome_busca", "%a\\%\\_\\\\%"]);
  });

  it("busca por número: formatos diferentes do mesmo telefone geram o mesmo filtro", async () => {
    const filtros: unknown[] = [];
    for (const termo of ["(11) 98765-4321", "11987654321", "011987654321"]) {
      falso.responder("clientes", { data: [], error: null });
      await buscarClientes(termo);
      filtros.push(falso.chamadasDe("clientes", "or").at(-1)?.args[0]);
    }
    expect(filtros).toEqual(Array(3).fill("whatsapp.like.*11987654321*,cpf.like.*11987654321*"));
    expect(falso.chamadasDe("clientes", "ilike")).toHaveLength(0);
  });

  it("com 55 também tenta sem 55; CPF formatado e pedaço de telefone funcionam", async () => {
    falso.responder("clientes", { data: [], error: null });
    await buscarClientes("+55 11 98765-4321");
    expect(falso.chamadasDe("clientes", "or")[0].args[0]).toBe(
      "whatsapp.like.*5511987654321*,cpf.like.*5511987654321*,whatsapp.like.*11987654321*,cpf.like.*11987654321*",
    );
    falso.responder("clientes", { data: [], error: null });
    await buscarClientes("529.982.247-25");
    expect(falso.chamadasDe("clientes", "or")[1].args[0]).toBe(
      "whatsapp.like.*52998224725*,cpf.like.*52998224725*",
    );
    falso.responder("clientes", { data: [], error: null });
    await buscarClientes("98765");
    expect(falso.chamadasDe("clientes", "or")[2].args[0]).toBe(
      "whatsapp.like.*98765*,cpf.like.*98765*",
    );
  });

  it("erro do banco vira exceção (a tela mostra o erro, não uma lista vazia)", async () => {
    falso.responder("clientes", { data: null, error: { code: "XX000", message: "boom" } });
    await expect(buscarClientes("ana")).rejects.toThrow();
  });
});
