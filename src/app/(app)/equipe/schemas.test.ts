import { describe, expect, it } from "vitest";
import {
  bloqueioSchema,
  colaboradorEdicaoSchema,
  colaboradorSchema,
  jornadasSchema,
  servicosDoColaboradorSchema,
} from "./schemas";

const valido = {
  nome: "Ana Souza",
  email: "ana@madamefe.com.br",
  funcao: "Esteticista",
  perfil: "profissional",
  cor: "#986818",
  telefone: "(11) 98765-4321",
};

describe("colaboradorSchema", () => {
  it("aceita dados válidos e normaliza telefone, e-mail e função", () => {
    const r = colaboradorSchema.safeParse({
      ...valido,
      email: "  Ana@MadameFe.com.br ",
      funcao: "  Esteticista ",
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.telefone).toBe("5511987654321");
      expect(r.data.email).toBe("ana@madamefe.com.br");
      expect(r.data.funcao).toBe("Esteticista");
    }
  });

  it("rejeita cor que não seja #RRGGBB", () => {
    expect(colaboradorSchema.safeParse({ ...valido, cor: "rosa" }).success).toBe(false);
    expect(colaboradorSchema.safeParse({ ...valido, cor: "#fff" }).success).toBe(false);
    expect(colaboradorSchema.safeParse({ ...valido, cor: "#GGGGGG" }).success).toBe(false);
  });

  it("rejeita e-mail inválido", () => {
    expect(colaboradorSchema.safeParse({ ...valido, email: "ana@" }).success).toBe(false);
    expect(colaboradorSchema.safeParse({ ...valido, email: "" }).success).toBe(false);
  });

  it("exige nome e perfil válido", () => {
    expect(colaboradorSchema.safeParse({ ...valido, nome: "   " }).success).toBe(false);
    expect(colaboradorSchema.safeParse({ ...valido, perfil: "admin" }).success).toBe(false);
  });

  it("telefone é opcional, mas se informado precisa normalizar", () => {
    const vazio = colaboradorSchema.safeParse({ ...valido, telefone: "" });
    expect(vazio.success).toBe(true);
    if (vazio.success) expect(vazio.data.telefone).toBeNull();

    const ausente = colaboradorSchema.safeParse({ ...valido, telefone: undefined });
    expect(ausente.success).toBe(true);

    expect(colaboradorSchema.safeParse({ ...valido, telefone: "123" }).success).toBe(false);
  });

  it("não tem campo de comissão (R9)", () => {
    const r = colaboradorSchema.safeParse({ ...valido, comissaoPadraoPct: 120 });
    expect(r.success).toBe(true);
    if (r.success) expect("comissaoPadraoPct" in r.data).toBe(false);
  });
});

describe("colaboradorEdicaoSchema", () => {
  it("não exige e-mail (ele não muda depois do convite)", () => {
    const { email, ...semEmail } = valido;
    void email;
    expect(colaboradorEdicaoSchema.safeParse(semEmail).success).toBe(true);
  });
});

describe("jornadasSchema", () => {
  it("aceita intervalos do mesmo dia sem sobreposição", () => {
    const r = jornadasSchema.safeParse([
      { diaSemana: 1, horaInicio: "09:00", horaFim: "12:00" },
      { diaSemana: 1, horaInicio: "13:00", horaFim: "18:00" },
    ]);
    expect(r.success).toBe(true);
  });

  it("aceita lista vazia (sem jornada)", () => {
    expect(jornadasSchema.safeParse([]).success).toBe(true);
  });

  it("rejeita horaFim antes de horaInicio", () => {
    const r = jornadasSchema.safeParse([
      { diaSemana: 1, horaInicio: "09:00", horaFim: "08:00" },
    ]);
    expect(r.success).toBe(false);
  });

  it("rejeita intervalo vazio (fim igual ao início)", () => {
    expect(
      jornadasSchema.safeParse([{ diaSemana: 1, horaInicio: "09:00", horaFim: "09:00" }]).success,
    ).toBe(false);
  });

  it("rejeita intervalos sobrepostos no mesmo dia", () => {
    const r = jornadasSchema.safeParse([
      { diaSemana: 1, horaInicio: "09:00", horaFim: "12:00" },
      { diaSemana: 1, horaInicio: "11:00", horaFim: "14:00" },
    ]);
    expect(r.success).toBe(false);
  });

  it("aceita o mesmo horário em dias diferentes", () => {
    const r = jornadasSchema.safeParse([
      { diaSemana: 1, horaInicio: "09:00", horaFim: "12:00" },
      { diaSemana: 2, horaInicio: "09:00", horaFim: "12:00" },
    ]);
    expect(r.success).toBe(true);
  });

  it("rejeita dia da semana fora de 0-6 e formato de hora inválido", () => {
    expect(
      jornadasSchema.safeParse([{ diaSemana: 7, horaInicio: "09:00", horaFim: "12:00" }]).success,
    ).toBe(false);
    expect(
      jornadasSchema.safeParse([{ diaSemana: -1, horaInicio: "09:00", horaFim: "12:00" }]).success,
    ).toBe(false);
    expect(
      jornadasSchema.safeParse([{ diaSemana: 1, horaInicio: "9h", horaFim: "12:00" }]).success,
    ).toBe(false);
    expect(
      jornadasSchema.safeParse([{ diaSemana: 1, horaInicio: "09:00", horaFim: "25:00" }]).success,
    ).toBe(false);
  });
});

describe("bloqueioSchema", () => {
  it("interpreta os horários no fuso de São Paulo", () => {
    const r = bloqueioSchema.safeParse({
      inicio: "2026-11-10T09:00",
      fim: "2026-11-12T18:00",
      motivo: "Férias",
    });
    expect(r.success).toBe(true);
    if (r.success) {
      // São Paulo = UTC-3 (sem horário de verão desde 2019).
      expect(r.data.inicio).toBe("2026-11-10T12:00:00.000Z");
      expect(r.data.fim).toBe("2026-11-12T21:00:00.000Z");
      expect(r.data.motivo).toBe("Férias");
    }
  });

  it("rejeita fim igual ou antes do início", () => {
    expect(
      bloqueioSchema.safeParse({
        inicio: "2026-11-10T09:00",
        fim: "2026-11-10T09:00",
        motivo: "Folga",
      }).success,
    ).toBe(false);
    expect(
      bloqueioSchema.safeParse({
        inicio: "2026-11-10T09:00",
        fim: "2026-11-09T09:00",
        motivo: "Folga",
      }).success,
    ).toBe(false);
  });

  it("rejeita motivo vazio, data inexistente e formato inválido", () => {
    const base = { inicio: "2026-11-10T09:00", fim: "2026-11-10T18:00", motivo: "Folga" };
    expect(bloqueioSchema.safeParse({ ...base, motivo: "  " }).success).toBe(false);
    expect(bloqueioSchema.safeParse({ ...base, inicio: "2026-02-30T09:00" }).success).toBe(false);
    expect(bloqueioSchema.safeParse({ ...base, fim: "amanhã" }).success).toBe(false);
  });
});

describe("servicosDoColaboradorSchema", () => {
  it("aceita lista de UUIDs sem repetição e remove duplicados", () => {
    const id = "6f1c2f4e-8f3a-4c2b-9d5e-1a2b3c4d5e6f";
    const r = servicosDoColaboradorSchema.safeParse([id, id]);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toEqual([id]);
  });

  it("rejeita ids que não são UUID", () => {
    expect(servicosDoColaboradorSchema.safeParse(["abc"]).success).toBe(false);
  });
});
