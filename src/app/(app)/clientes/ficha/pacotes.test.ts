import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Perfil } from "@/lib/dominio/permissoes";
import { criarSupabaseFalso } from "@/test/supabase-falso";

let perfilAtual: Perfil | null = "recepcao";
const exigirPerfil = vi.fn(async (...perfis: Perfil[]) => {
  if (!perfilAtual) throw new Error("REDIRECT:/login");
  if (perfis.length > 0 && !perfis.includes(perfilAtual)) throw new Error("REDIRECT:/inicio");
  return { userId: "u1", colaborador: { id: "c0", nome: "Teste", perfil: perfilAtual } };
});
vi.mock("@/lib/sessao", () => ({ exigirPerfil: (...p: Perfil[]) => exigirPerfil(...p) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("server-only", () => ({}));

let falso = criarSupabaseFalso();
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => falso.cliente }));

import { carregarPacotes } from "./dados";
import type { Supabase } from "@/lib/ficha/acesso";
import { cancelarPacote, pacotesDisponiveis, venderPacote } from "./pacotes";

const CL = "7d2e3f74-5e60-4b8c-8d9f-3c4d5e6f7081";
const SV = "6c1d2e63-4d5f-4a7b-9c8e-2b3c4d5e6f70";
const PK = "8e3f4085-6f71-4c9d-9eaf-4d5e6f708192";

const venda = {
  clienteId: CL,
  servicoId: SV,
  sessoes: 4,
  valorTotal: "1.000,00",
  validade: null,
  desconto: "",
  partes: [
    { forma: "pix" as const, valor: "600,00", parcelas: 1 },
    { forma: "credito_parcelado" as const, valor: "400,00", parcelas: 2 },
  ],
};

beforeEach(() => {
  perfilAtual = "recepcao";
  falso = criarSupabaseFalso();
  exigirPerfil.mockClear();
});

describe("venderPacote", () => {
  it("recepção vende: chama vender_pacote com centavos e partes", async () => {
    falso.responder("rpc:vender_pacote", { data: PK, error: null });
    expect(await venderPacote(venda)).toEqual({ ok: true, id: PK });
    const args = falso.chamadasRpc("vender_pacote")[0].args[0] as Record<string, unknown>;
    expect(args).toMatchObject({
      p_cliente: CL,
      p_servico: SV,
      p_total_sessoes: 4,
      p_valor_total_centavos: 100000,
      p_validade: null,
      p_desconto_centavos: 0,
    });
    expect(args.p_partes).toEqual([
      { forma: "pix", valor_centavos: 60000, parcelas: 1, vencimentos: null, valores_parcelas: null },
      {
        forma: "credito_parcelado",
        valor_centavos: 40000,
        parcelas: 2,
        vencimentos: null,
        valores_parcelas: null,
      },
    ]);
  });

  it("desconta o desconto antes de conferir as partes", async () => {
    falso.responder("rpc:vender_pacote", { data: PK, error: null });
    const r = await venderPacote({ ...venda, desconto: "100,00" });
    expect(r.ok).toBe(false);
    expect(falso.chamadasRpc("vender_pacote")).toHaveLength(0);
  });

  it.each([0, 51])("recusa %i sessões sem RPC", async (n) => {
    expect(await venderPacote({ ...venda, sessoes: n })).toEqual({
      ok: false,
      erro: "Informe de 1 a 50 sessões.",
    });
    expect(falso.chamadasRpc("vender_pacote")).toHaveLength(0);
  });

  it("recusa validade passada", async () => {
    expect(await venderPacote({ ...venda, validade: "2020-01-01" })).toEqual({
      ok: false,
      erro: "A validade não pode ser anterior a hoje.",
    });
  });

  it("partes que não fecham não chamam o banco", async () => {
    const r = await venderPacote({
      ...venda,
      partes: [{ forma: "pix", valor: "600,00", parcelas: 1 }],
    });
    expect(r.ok).toBe(false);
    expect(falso.chamadasRpc("vender_pacote")).toHaveLength(0);
  });

  it("repassa erro do banco", async () => {
    falso.responder("rpc:vender_pacote", {
      data: null,
      error: { code: "P0001", message: "O caixa de hoje não está aberto." },
    });
    const r = await venderPacote(venda);
    expect(r.ok).toBe(false);
  });

  it("profissional é redirecionada", async () => {
    perfilAtual = "profissional";
    await expect(venderPacote(venda)).rejects.toThrow("REDIRECT:/inicio");
  });
});

describe("cancelarPacote", () => {
  it("recepção é redirecionada", async () => {
    await expect(cancelarPacote(PK)).rejects.toThrow("REDIRECT:/inicio");
    expect(falso.chamadasRpc("cancelar_pacote")).toHaveLength(0);
  });

  it("dona cancela via RPC", async () => {
    perfilAtual = "dona";
    falso.responder("rpc:cancelar_pacote", { data: null, error: null });
    expect(await cancelarPacote(PK)).toEqual({ ok: true });
    expect(falso.chamadasRpc("cancelar_pacote")[0].args[0]).toEqual({ p_pacote: PK });
  });

  it("id inválido", async () => {
    perfilAtual = "dona";
    expect((await cancelarPacote("x")).ok).toBe(false);
  });
});

describe("pacotesDisponiveis", () => {
  it("expira, lista e devolve só os utilizáveis", async () => {
    falso.responder("rpc:expirar_pacotes", { data: 0, error: null });
    falso.responder("pacotes_vendidos", {
      data: [
        { id: "a", servico_id: SV, status: "ativo", validade: null, sessoes_usadas: 1, total_sessoes: 4 },
        { id: "b", servico_id: SV, status: "ativo", validade: "2020-01-01", sessoes_usadas: 1, total_sessoes: 4 },
        { id: "c", servico_id: SV, status: "ativo", validade: null, sessoes_usadas: 4, total_sessoes: 4 },
      ],
      error: null,
    });
    expect(await pacotesDisponiveis(CL, SV)).toEqual([{ id: "a", restantes: 3, validade: null }]);
    expect(falso.chamadasRpc("expirar_pacotes")).toHaveLength(1);
  });

  it("profissional é redirecionada", async () => {
    perfilAtual = "profissional";
    await expect(pacotesDisponiveis(CL, SV)).rejects.toThrow("REDIRECT:/inicio");
  });
});

describe("carregarPacotes", () => {
  it("ignora falha do expirar e mapeia status efetivo e progresso", async () => {
    falso.responder("rpc:expirar_pacotes", { data: null, error: { message: "falhou" } });
    falso.responder("pacotes_vendidos", {
      data: [
        {
          id: "a",
          servico_id: SV,
          status: "ativo",
          validade: "2020-01-01",
          sessoes_usadas: 3,
          total_sessoes: 10,
          valor_total_centavos: 100000,
          servicos: { nome: "Limpeza" },
        },
      ],
      error: null,
    });
    const r = await carregarPacotes(falso.cliente as unknown as Supabase, CL);
    expect(r).toEqual([
      {
        id: "a",
        servicoId: SV,
        servicoNome: "Limpeza",
        status: "expirado",
        validade: "2020-01-01",
        sessoesUsadas: 3,
        totalSessoes: 10,
        valorTotalCentavos: 100000,
        restantes: 7,
        percentual: 30,
      },
    ]);
  });
});
