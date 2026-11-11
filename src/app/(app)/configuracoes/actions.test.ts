import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Perfil } from "@/lib/dominio/permissoes";
import { criarSupabaseFalso } from "@/test/supabase-falso";

let perfilAtual: Perfil = "dona";
const exigirPerfil = vi.fn(async (...perfis: Perfil[]) => {
  if (perfis.length > 0 && !perfis.includes(perfilAtual)) throw new Error("REDIRECT:/inicio");
  return { userId: "u1", colaborador: { id: "c1", nome: "Teste", perfil: perfilAtual } };
});
vi.mock("@/lib/sessao", () => ({ exigirPerfil: (...p: Perfil[]) => exigirPerfil(...p) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

let falso = criarSupabaseFalso();
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => falso.cliente }));

import { salvarConfigWhatsapp, salvarModelo } from "./actions";

const config = { ativo: true, janelaInicio: "09:00", janelaFim: "19:00", limitePorHora: 20 };

beforeEach(() => {
  perfilAtual = "dona";
  falso = criarSupabaseFalso();
  falso.definirPadrao({ data: null, error: null });
});

describe("salvarConfigWhatsapp", () => {
  it("recepção é negada sem tocar no banco", async () => {
    perfilAtual = "recepcao";
    await expect(salvarConfigWhatsapp(config)).rejects.toThrow("REDIRECT:/inicio");
    expect(falso.chamadas).toHaveLength(0);
    expect(exigirPerfil).toHaveBeenCalledWith("dona");
  });

  it("recusa janela invertida ou vazia", async () => {
    expect((await salvarConfigWhatsapp({ ...config, janelaInicio: "19:00", janelaFim: "09:00" })).ok).toBe(false);
    expect((await salvarConfigWhatsapp({ ...config, janelaInicio: "09:00", janelaFim: "09:00" })).ok).toBe(false);
    expect(falso.chamadas).toHaveLength(0);
  });

  it("recusa limite 0 e 201", async () => {
    expect((await salvarConfigWhatsapp({ ...config, limitePorHora: 0 })).ok).toBe(false);
    expect((await salvarConfigWhatsapp({ ...config, limitePorHora: 201 })).ok).toBe(false);
    expect(falso.chamadas).toHaveLength(0);
  });

  it("salva os campos", async () => {
    expect(await salvarConfigWhatsapp(config)).toEqual({ ok: true });
    expect(falso.chamadasDe("configuracoes_clinica", "update")[0].args[0]).toEqual({
      whatsapp_ativo: true,
      whatsapp_janela_inicio: "09:00",
      whatsapp_janela_fim: "19:00",
      whatsapp_limite_por_hora: 20,
    });
  });
});

describe("salvarModelo", () => {
  const modelo = { tipo: "lembrete" as const, variacoes: ["Oi, {nome}!"], ativo: true };

  it("recepção é negada", async () => {
    perfilAtual = "recepcao";
    await expect(salvarModelo(modelo)).rejects.toThrow("REDIRECT:/inicio");
    expect(falso.chamadas).toHaveLength(0);
  });

  it("recusa 6 variações, 0 variações, só espaços e acima de 1000", async () => {
    expect((await salvarModelo({ ...modelo, variacoes: Array(6).fill("a") })).ok).toBe(false);
    expect((await salvarModelo({ ...modelo, variacoes: [] })).ok).toBe(false);
    expect((await salvarModelo({ ...modelo, variacoes: ["ok", "   "] })).ok).toBe(false);
    expect((await salvarModelo({ ...modelo, variacoes: ["x".repeat(1001)] })).ok).toBe(false);
    expect(falso.chamadas).toHaveLength(0);
  });

  it("salva variações aparadas", async () => {
    expect(await salvarModelo({ ...modelo, variacoes: ["  A  ", "B"], ativo: false })).toEqual({ ok: true });
    const u = falso.chamadasDe("modelos_mensagem", "update")[0].args[0] as Record<string, unknown>;
    expect(u.variacoes).toEqual(["A", "B"]);
    expect(u.ativo).toBe(false);
    expect(falso.chamadasDe("modelos_mensagem", "eq")[0].args).toEqual(["tipo", "lembrete"]);
  });
});
