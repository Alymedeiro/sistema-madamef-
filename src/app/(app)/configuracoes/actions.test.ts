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

import { salvarConfiguracoes, salvarConfigWhatsapp, salvarModelo, salvarRobo } from "./actions";

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
    falso.responder("configuracoes_clinica", { data: [{ linha_unica: true }], error: null });
    expect(await salvarConfigWhatsapp(config)).toEqual({ ok: true });
    expect(falso.chamadasDe("configuracoes_clinica", "update")[0].args[0]).toEqual({
      whatsapp_ativo: true,
      whatsapp_janela_inicio: "09:00",
      whatsapp_janela_fim: "19:00",
      whatsapp_limite_por_hora: 20,
    });
    expect(falso.chamadasDe("configuracoes_clinica", "select")).toHaveLength(1);
  });

  it("nenhuma linha atualizada → 'Configuração não encontrada.'", async () => {
    for (const data of [[], null]) {
      falso.responder("configuracoes_clinica", { data, error: null });
      expect(await salvarConfigWhatsapp(config)).toEqual({
        ok: false,
        erro: "Configuração não encontrada.",
      });
    }
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
    falso.responder("modelos_mensagem", { data: [{ tipo: "lembrete" }], error: null });
    expect(await salvarModelo({ ...modelo, variacoes: ["  A  ", "B"], ativo: false })).toEqual({ ok: true });
    const u = falso.chamadasDe("modelos_mensagem", "update")[0].args[0] as Record<string, unknown>;
    expect(u.variacoes).toEqual(["A", "B"]);
    expect(u.ativo).toBe(false);
    expect(falso.chamadasDe("modelos_mensagem", "eq")[0].args).toEqual(["tipo", "lembrete"]);
  });

  it("nenhuma linha atualizada → 'Modelo não encontrado.'", async () => {
    falso.responder("modelos_mensagem", { data: [], error: null });
    expect(await salvarModelo(modelo)).toEqual({ ok: false, erro: "Modelo não encontrado." });
  });

  it("avulsa não tem modelo: recusada sem tocar no banco", async () => {
    const r = await salvarModelo({ ...modelo, tipo: "avulsa" as never });
    expect(r.ok).toBe(false);
    expect(falso.chamadas).toHaveLength(0);
  });
});

describe("salvarConfiguracoes: dias para cliente sumida", () => {
  const dia = [{ inicio: "09:00", fim: "18:00" }];
  const dados = {
    nome: "Madame Fê Clinic",
    telefone: "",
    endereco: "",
    horarioFuncionamento: { "0": [], "1": dia, "2": dia, "3": dia, "4": dia, "5": dia, "6": [] },
    diasClienteSumida: 90,
    onlineAtivo: false,
    onlineAntecedenciaMinHoras: 2,
    onlineAntecedenciaMaxDias: 60,
    onlineAvisoPrivacidade: "Usamos seus dados apenas para agendar o atendimento.",
  };

  it("0 e 731 são recusados antes do banco", async () => {
    for (const v of [0, 731]) {
      expect(await salvarConfiguracoes({ ...dados, diasClienteSumida: v })).toEqual({
        ok: false,
        erro: "Use um número entre 1 e 730.",
      });
    }
    expect(falso.chamadas).toHaveLength(0);
  });

  it("90 é salvo em dias_cliente_sumida", async () => {
    expect(await salvarConfiguracoes(dados)).toEqual({ ok: true });
    expect(falso.chamadasDe("configuracoes_clinica", "upsert")[0].args[0]).toMatchObject({
      dias_cliente_sumida: 90,
    });
  });
});

describe("salvarRobo", () => {
  const robo = {
    ativo: true,
    quando: "fora_do_horario" as const,
    boasVindas: "Oi, {nome}!",
    naoEntendi: "Hein?",
    rodapeOpcao: " Digite 0 ",
    linkAgendamento: "",
    opcoes: [
      { numero: 2, rotulo: "Equipe", tipo: "falar_com_equipe" as const, resposta: null, ativo: true },
      { numero: 1, rotulo: "Preços", tipo: "texto" as const, resposta: "R$ 10", ativo: false },
    ],
  };

  it("recepção e profissional são negadas sem tocar no banco", async () => {
    for (const p of ["recepcao", "profissional"] as const) {
      perfilAtual = p;
      await expect(salvarRobo(robo)).rejects.toThrow("REDIRECT:/inicio");
    }
    expect(falso.chamadas).toHaveLength(0);
    expect(exigirPerfil).toHaveBeenCalledWith("dona");
  });

  it("dados inválidos não tocam no banco", async () => {
    const r = await salvarRobo({ ...robo, opcoes: [robo.opcoes[0], { ...robo.opcoes[1], numero: 2 }] });
    expect(r).toEqual({ ok: false, erro: "Cada opção precisa de um número diferente." });
    expect(falso.chamadas).toHaveLength(0);
  });

  it("chama salvar_robo com os campos aparados e as opções em ordem", async () => {
    expect(await salvarRobo(robo)).toEqual({ ok: true });
    expect(falso.chamadasRpc("salvar_robo")[0].args[0]).toEqual({
      p_ativo: true,
      p_quando: "fora_do_horario",
      p_boas_vindas: "Oi, {nome}!",
      p_nao_entendi: "Hein?",
      p_rodape_opcao: "Digite 0",
      p_link_agendamento: null,
      p_opcoes: [
        { numero: 1, rotulo: "Preços", tipo: "texto", resposta: "R$ 10", ativo: false },
        { numero: 2, rotulo: "Equipe", tipo: "falar_com_equipe", resposta: null, ativo: true },
      ],
    });
  });

  it("erro P0001 do banco vira a mensagem", async () => {
    falso.responder("rpc:salvar_robo", {
      data: null,
      error: { code: "P0001", message: "Apenas a dona pode alterar o robô." },
    });
    expect(await salvarRobo(robo)).toEqual({ ok: false, erro: "Apenas a dona pode alterar o robô." });
  });
});
