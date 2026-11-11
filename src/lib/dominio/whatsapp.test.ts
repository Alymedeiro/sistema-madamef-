import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  classificarResposta,
  dadosDaMensagem,
  podeEnviar,
  renderizarMensagem,
  TEXTOS_PADRAO,
} from "./whatsapp";

describe("renderizarMensagem", () => {
  it("troca variáveis, usa primeiro nome e deixa vazio o que falta", () => {
    expect(
      renderizarMensagem(["Oi {nome}, {hora} {servico}|{data}|{clinica}."], {
        nome: "Maria da Silva",
        hora: "10:00",
      }),
    ).toBe("Oi Maria, 10:00 ||.");
  });
  it("mantém variável desconhecida literal", () => {
    expect(renderizarMensagem(["Oi {foo} {nome}"], { nome: "Ana" })).toBe("Oi {foo} Ana");
  });
  it("sortear escolhe a variação", () => {
    expect(renderizarMensagem(["a", "b", "c"], {}, () => 1)).toBe("b");
  });
});

describe("dadosDaMensagem", () => {
  it("formata data e hora em São Paulo", () => {
    const d = dadosDaMensagem({
      nome: "Ana Souza",
      inicio: "2026-11-12T01:30:00Z",
      servico: "Limpeza",
      profissional: "Bia",
      clinica: "Madame Fê",
    });
    expect(d).toMatchObject({ data: "11/11", hora: "22:30", servico: "Limpeza" });
  });
  it("sem início, sem data nem hora", () => {
    expect(dadosDaMensagem({ nome: "Ana", inicio: null })).toMatchObject({
      data: undefined,
      hora: undefined,
    });
  });
});

describe("podeEnviar", () => {
  const agora = new Date("2026-11-11T12:00:00Z");
  const futuro = new Date("2026-11-12T12:00:00Z");
  const passado = new Date("2026-11-11T11:00:00Z");
  it("confirmação", () => {
    expect(podeEnviar("confirmacao", "pendente", futuro, agora)).toEqual({ ok: true });
    expect(podeEnviar("confirmacao", "confirmado", futuro, agora)).toEqual({
      ok: false,
      motivo: "Agendamento não está mais pendente",
    });
    expect(podeEnviar("confirmacao", "pendente", passado, agora)).toEqual({
      ok: false,
      motivo: "Horário já passou",
    });
  });
  it("lembrete", () => {
    expect(podeEnviar("lembrete", "confirmado", futuro, agora)).toEqual({ ok: true });
    expect(podeEnviar("lembrete", "pendente", futuro, agora)).toEqual({
      ok: false,
      motivo: "Agendamento não está confirmado",
    });
    expect(podeEnviar("lembrete", "confirmado", passado, agora)).toEqual({
      ok: false,
      motivo: "Horário já passou",
    });
  });
  it("pós-atendimento", () => {
    expect(podeEnviar("pos_atendimento", "atendido", passado, agora)).toEqual({ ok: true });
    expect(podeEnviar("pos_atendimento", "confirmado", passado, agora)).toEqual({
      ok: false,
      motivo: "Agendamento não foi atendido",
    });
  });
  it("outros sempre ok", () => {
    for (const t of ["aniversario", "pedido_aprovado", "pedido_recusado", "avulsa"] as const)
      expect(podeEnviar(t, null, null, agora)).toEqual({ ok: true });
  });
});

describe("classificarResposta", () => {
  it.each([
    ["1", "confirmou"],
    [" 1. ", "confirmou"],
    ["Sim", "confirmou"],
    ["CONFIRMO", "confirmou"],
    ["confirmar", "confirmou"],
    ["2", "quer_remarcar"],
    ["2.", "quer_remarcar"],
    ["Quero remarcar", "para_ler"],
    ["talvez", "para_ler"],
  ] as const)("%s -> %s", (texto, esperado) => {
    expect(classificarResposta(texto)).toBe(esperado);
  });
});

describe("TEXTOS_PADRAO", () => {
  it("é igual ao inserido na migração", () => {
    const sql = readFileSync("supabase/migrations/0012_whatsapp.sql", "utf8");
    for (const [tipo, texto] of Object.entries(TEXTOS_PADRAO)) {
      expect(sql).toContain(`('${tipo}', array['${texto}'])`);
    }
  });
});
