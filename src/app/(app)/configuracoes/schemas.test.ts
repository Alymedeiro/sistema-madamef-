import { describe, expect, it } from "vitest";
import {
  configuracoesSchema,
  horarioFuncionamentoSchema,
  modeloSchema,
  roboConfigSchema,
  TIPOS_MODELO,
} from "./schemas";

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
    diasClienteSumida: 90,
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

  it("dias para cliente sumida: 1 a 730, inteiro", () => {
    const r = (v: number) => configuracoesSchema.safeParse({ ...base, diasClienteSumida: v });
    expect(r(1).success).toBe(true);
    expect(r(90).success).toBe(true);
    expect(r(730).success).toBe(true);
    for (const v of [0, 731, 1.5, Number.NaN]) {
      const x = r(v);
      expect(x.success).toBe(false);
      expect(x.error?.issues[0].message).toBe("Use um número entre 1 e 730.");
    }
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
      [
        "aniversario",
        "confirmacao",
        "lembrete",
        "pedido_aprovado",
        "pedido_recusado",
        "pos_atendimento",
        "reativacao",
        "retorno",
      ],
    );
    const ok = { variacoes: ["Oi"], ativo: true };
    expect(modeloSchema.safeParse({ ...ok, tipo: "lembrete" }).success).toBe(true);
    expect(modeloSchema.safeParse({ ...ok, tipo: "avulsa" }).success).toBe(false);
  });
});

describe("roboConfigSchema", () => {
  const opcao = (numero: number, extra: Record<string, unknown> = {}) => ({
    numero,
    rotulo: `Opção ${numero}`,
    tipo: "falar_com_equipe" as const,
    resposta: null,
    ativo: true,
    ...extra,
  });
  const base = {
    ativo: true,
    quando: "sempre" as const,
    boasVindas: " Oi, {nome}! ",
    naoEntendi: "Hein?",
    rodapeOpcao: "",
    linkAgendamento: "",
    opcoes: [opcao(1)],
  };

  it("aceita, apara e transforma link vazio em null", () => {
    const r = roboConfigSchema.parse(base);
    expect(r.boasVindas).toBe("Oi, {nome}!");
    expect(r.linkAgendamento).toBeNull();
  });

  it("até 8 opções; a 9ª é recusada", () => {
    const oito = Array.from({ length: 8 }, (_, i) => opcao(i + 1));
    expect(roboConfigSchema.safeParse({ ...base, opcoes: oito }).success).toBe(true);
    const nove = [...oito, opcao(8)];
    expect(roboConfigSchema.safeParse({ ...base, opcoes: nove }).success).toBe(false);
  });

  it("números únicos e de 1 a 8", () => {
    const r = roboConfigSchema.safeParse({ ...base, opcoes: [opcao(1), opcao(1)] });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0].message).toBe("Cada opção precisa de um número diferente.");
    expect(roboConfigSchema.safeParse({ ...base, opcoes: [opcao(9)] }).success).toBe(false);
    expect(roboConfigSchema.safeParse({ ...base, opcoes: [opcao(0)] }).success).toBe(false);
  });

  it("resposta obrigatória no tipo texto; nos outros tipos vira null", () => {
    const sem = roboConfigSchema.safeParse({ ...base, opcoes: [opcao(1, { tipo: "texto", resposta: "  " })] });
    expect(sem.success).toBe(false);
    expect(sem.error?.issues[0].message).toBe("Escreva a resposta desta opção.");
    const com = roboConfigSchema.parse({ ...base, opcoes: [opcao(1, { tipo: "texto", resposta: " Oi " })] });
    expect(com.opcoes[0].resposta).toBe("Oi");
    const link = roboConfigSchema.parse({
      ...base,
      opcoes: [opcao(1, { tipo: "agendar_online", resposta: "sobrou" })],
    });
    expect(link.opcoes[0].resposta).toBeNull();
  });

  it("rótulo 1–60, textos obrigatórios, link http(s) e quando válido", () => {
    expect(roboConfigSchema.safeParse({ ...base, opcoes: [opcao(1, { rotulo: " " })] }).success).toBe(false);
    expect(roboConfigSchema.safeParse({ ...base, opcoes: [opcao(1, { rotulo: "x".repeat(61) })] }).success).toBe(false);
    expect(roboConfigSchema.safeParse({ ...base, boasVindas: "  " }).success).toBe(false);
    expect(roboConfigSchema.safeParse({ ...base, naoEntendi: "x".repeat(1001) }).success).toBe(false);
    expect(roboConfigSchema.safeParse({ ...base, linkAgendamento: "x.com" }).success).toBe(false);
    expect(roboConfigSchema.safeParse({ ...base, quando: "nunca" }).success).toBe(false);
  });

  it("TIPOS_MODELO não inclui avulsa nem robo", () => {
    expect(TIPOS_MODELO).not.toContain("robo");
    expect(TIPOS_MODELO).not.toContain("avulsa");
  });
});
