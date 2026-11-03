import { describe, expect, it } from "vitest";
import { configuracoesSchema, horarioFuncionamentoSchema } from "./schemas";

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
});
