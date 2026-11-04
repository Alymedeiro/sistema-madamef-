import { describe, expect, it } from "vitest";
import { validarAgendamento } from "@/lib/dominio/agenda";
import { combinarDataHora as sp } from "@/lib/dominio/tempo";
import { janelaDeBusca, limitesDoDia, montarContextoAgenda } from "./contexto";

describe("limitesDoDia", () => {
  it("vai da meia-noite à meia-noite de São Paulo", () => {
    const { inicio, fim } = limitesDoDia("2026-11-03");
    expect(inicio.toISOString()).toBe("2026-11-03T03:00:00.000Z");
    expect(fim.toISOString()).toBe("2026-11-04T03:00:00.000Z");
  });
});

describe("janelaDeBusca", () => {
  it("é o dia inteiro quando o atendimento termina no mesmo dia", () => {
    const j = janelaDeBusca("2026-11-03", sp("2026-11-03", "18:00"));
    expect(j.inicio.toISOString()).toBe("2026-11-03T03:00:00.000Z");
    expect(j.fim.toISOString()).toBe("2026-11-04T03:00:00.000Z");
  });

  it("estende até o fim do atendimento que passa da meia-noite", () => {
    const j = janelaDeBusca("2026-11-03", sp("2026-11-04", "01:00"));
    expect(j.fim.toISOString()).toBe("2026-11-04T04:00:00.000Z");
  });
});

describe("montarContextoAgenda", () => {
  const ctx = montarContextoAgenda({
    jornadas: [
      { dia_semana: 2, hora_inicio: "09:00:00", hora_fim: "12:00:00" },
      { dia_semana: 2, hora_inicio: "13:00:00", hora_fim: "18:00:00" },
    ],
    bloqueios: [{ inicio: "2026-11-03T20:00:00+00:00", fim: "2026-11-03T21:00:00+00:00" }],
    agendamentos: [
      {
        id: "ag1",
        inicio: "2026-11-03T13:00:00+00:00",
        fim: "2026-11-03T14:00:00+00:00",
        status: "confirmado",
      },
    ],
    servicoIds: ["s1"],
  });

  it("normaliza as horas do Postgres para HH:mm", () => {
    expect(ctx.jornadas).toEqual([
      { diaSemana: 2, horaInicio: "09:00", horaFim: "12:00" },
      { diaSemana: 2, horaInicio: "13:00", horaFim: "18:00" },
    ]);
  });

  it("converte timestamptz em Date", () => {
    expect(ctx.agendamentos[0]).toEqual({
      id: "ag1",
      inicio: sp("2026-11-03", "10:00"),
      fim: sp("2026-11-03", "11:00"),
      status: "confirmado",
    });
    expect(ctx.bloqueios[0]).toEqual({ inicio: sp("2026-11-03", "17:00"), fim: sp("2026-11-03", "18:00") });
    expect(ctx.servicosDaProfissional).toEqual(["s1"]);
  });

  it("serve direto para validarAgendamento (sem lançar por formato de hora)", () => {
    const base = { duracaoMin: 60, servicoId: "s1" };
    expect(validarAgendamento({ ...base, inicio: sp("2026-11-03", "09:00") }, ctx)).toEqual({
      erros: [],
      avisos: [],
    });
    expect(validarAgendamento({ ...base, inicio: sp("2026-11-03", "10:30") }, ctx).erros).toEqual([
      "sobreposicao",
    ]);
    expect(validarAgendamento({ ...base, inicio: sp("2026-11-03", "12:30") }, ctx).avisos).toEqual([
      "fora_da_jornada",
    ]);
    expect(validarAgendamento({ ...base, inicio: sp("2026-11-03", "17:00") }, ctx).erros).toEqual([
      "bloqueio",
    ]);
  });
});
