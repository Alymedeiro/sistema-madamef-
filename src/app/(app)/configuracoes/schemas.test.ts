import { describe, expect, it } from "vitest";
import { configuracoesSchema, horarioFuncionamentoSchema, modeloSchema, TIPOS_MODELO } from "./schemas";

const fechado = { "0": [], "1": [], "2": [], "3": [], "4": [], "5": [], "6": [] };
const util = [{ inicio: "09:00", fim: "19:00" }];

describe("horarioFuncionamentoSchema", () => {
  it("aceita dias fechados (lista vazia) e dias com intervalos", () => {
    const r = horarioFuncionamentoSchema.safeParse({
      ...fechado,
      "1": util,
      "6": [
        { inicio: "09:00", fim: "12:00" },
        { inicio: "13:00", fim: "17:00" },
      ],
    });
    expect(r.success).toBe(true);
  });

  it("rejeita fim antes do início", () => {
    const r = horarioFuncionamentoSchema.safeParse({
      ...fechado,
      "1": [{ inicio: "19:00", fim: "09:00" }],
    });
    expect(r.success).toBe(false);
  });

  it("rejeita intervalos sobrepostos no mesmo dia", () => {
    const r = horarioFuncionamentoSchema.safeParse({
      ...fechado,
      "2": [
        { inicio: "09:00", fim: "12:00" },
        { inicio: "11:30", fim: "15:00" },
      ],
    });
    expect(r.success).toBe(false);
  });

  it("rejeita chave fora de 0-6, dia faltando e formato de hora inválido", () => {
    expect(horarioFuncionamentoSchema.safeParse({ ...fechado, "7": util }).success).toBe(false);
    const { "3": _tres, ...faltando } = fechado;
    void _tres;
    expect(horarioFuncionamentoSchema.safeParse(faltando).success).toBe(false);
    expect(
      horarioFuncionamentoSchema.safeParse({
        ...fechado,
        "1": [{ inicio: "9:00", fim: "19:00" }],
      }).success,
    ).toBe(false);
  });
});

describe("configuracoesSchema", () => {
  const base = {
    nome: "Madame Fê Clinic",
    telefone: "(11) 3456-7890",
    endereco: "Rua das Flores, 100",
    horarioFuncionamento: { ...fechado, "1": util },
    onlineAtivo: false,
    onlineAntecedenciaMinHoras: 2,
    onlineAntecedenciaMaxDias: 60,
    onlineAvisoPrivacidade: "Usamos seus dados apenas para agendar o atendimento.",
  };

  it("aceita dados válidos e normaliza o telefone", () => {
    const r = configuracoesSchema.safeParse(base);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.telefone).toBe("551134567890");
  });

  it("telefone e endereço são opcionais", () => {
    const r = configuracoesSchema.safeParse({ ...base, telefone: "", endereco: "" });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.telefone).toBeNull();
      expect(r.data.endereco).toBeNull();
    }
  });

  it("exige nome e telefone normalizável", () => {
    expect(configuracoesSchema.safeParse({ ...base, nome: " " }).success).toBe(false);
    expect(configuracoesSchema.safeParse({ ...base, telefone: "12" }).success).toBe(false);
  });

  it("onlineAtivo tem padrão false", () => {
    const { onlineAtivo: _a, ...semAtivo } = base;
    void _a;
    const r = configuracoesSchema.safeParse(semAtivo);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.onlineAtivo).toBe(false);
  });

  it("limites da antecedência mínima (0 a 72 horas, inteiro)", () => {
    const ok = (v: number) =>
      configuracoesSchema.safeParse({ ...base, onlineAntecedenciaMinHoras: v }).success;
    expect(ok(0)).toBe(true);
    expect(ok(72)).toBe(true);
    expect(ok(-1)).toBe(false);
    expect(ok(73)).toBe(false);
    expect(ok(1.5)).toBe(false);
  });

  it("limites da antecedência máxima (1 a 180 dias, inteiro)", () => {
    const ok = (v: number) =>
      configuracoesSchema.safeParse({ ...base, onlineAntecedenciaMaxDias: v }).success;
    expect(ok(1)).toBe(true);
    expect(ok(180)).toBe(true);
    expect(ok(0)).toBe(false);
    expect(ok(181)).toBe(false);
    expect(ok(2.5)).toBe(false);
  });

  it("aviso de privacidade: 20 a 1000 caracteres após aparar", () => {
    const r = (t: string) =>
      configuracoesSchema.safeParse({ ...base, onlineAvisoPrivacidade: t });
    expect(r("a".repeat(19)).success).toBe(false);
    expect(r("  " + "a".repeat(19) + "  ").success).toBe(false);
    expect(r("a".repeat(20)).success).toBe(true);
    expect(r("a".repeat(1000)).success).toBe(true);
    expect(r("a".repeat(1001)).success).toBe(false);
  });
});

describe("TIPOS_MODELO e modeloSchema", () => {
  it("são os tipos de mensagem menos avulsa", () => {
    expect([...TIPOS_MODELO].sort()).toEqual(
      ["aniversario", "confirmacao", "lembrete", "pedido_aprovado", "pedido_recusado", "pos_atendimento"],
    );
    const ok = { variacoes: ["Oi"], ativo: true };
    expect(modeloSchema.safeParse({ ...ok, tipo: "lembrete" }).success).toBe(true);
    expect(modeloSchema.safeParse({ ...ok, tipo: "avulsa" }).success).toBe(false);
  });
});
