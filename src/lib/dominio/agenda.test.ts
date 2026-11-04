import { describe, expect, it } from "vitest";
import {
  calcularFim,
  MENSAGEM_VALIDACAO,
  validarAgendamento,
  type ContextoAgenda,
} from "./agenda";
import { combinarDataHora as sp } from "./tempo";

// 2026-11-03 é terça; 2026-11-04 é quarta.
const ctx: ContextoAgenda = {
  jornadas: [
    { diaSemana: 2, horaInicio: "09:00", horaFim: "12:00" },
    { diaSemana: 2, horaInicio: "13:00", horaFim: "18:00" },
  ],
  bloqueios: [{ inicio: sp("2026-11-04", "00:00"), fim: sp("2026-11-05", "00:00") }],
  agendamentos: [
    { id: "ag1", inicio: sp("2026-11-03", "10:00"), fim: sp("2026-11-03", "11:00"), status: "confirmado" },
  ],
  servicosDaProfissional: ["s1"],
};
const prop = (data: string, hora: string, duracaoMin: number, extra = {}) => ({
  inicio: sp(data, hora),
  duracaoMin,
  servicoId: "s1",
  ...extra,
});

describe("calcularFim", () => {
  it("soma minutos", () => {
    expect(calcularFim(sp("2026-11-03", "10:00"), 45)).toEqual(sp("2026-11-03", "10:45"));
  });
  it("rejeita duração inválida", () => {
    expect(() => calcularFim(sp("2026-11-03", "10:00"), 0)).toThrow(RangeError);
    expect(() => calcularFim(sp("2026-11-03", "10:00"), -5)).toThrow(RangeError);
    expect(() => calcularFim(sp("2026-11-03", "10:00"), 1.5)).toThrow(RangeError);
  });
});

describe("validarAgendamento", () => {
  it("detecta sobreposição", () => {
    expect(validarAgendamento(prop("2026-11-03", "10:30", 60), ctx).erros).toContain("sobreposicao");
  });
  it("encostar não é sobrepor", () => {
    expect(validarAgendamento(prop("2026-11-03", "11:00", 60), ctx)).toEqual({ erros: [], avisos: [] });
    expect(validarAgendamento(prop("2026-11-03", "09:00", 60), ctx)).toEqual({ erros: [], avisos: [] });
  });
  it("ignora o próprio agendamento ao remarcar", () => {
    expect(validarAgendamento(prop("2026-11-03", "10:15", 60, { id: "ag1" }), ctx).erros).toEqual([]);
  });
  it("cancelado não ocupa o horário", () => {
    const c = { ...ctx, agendamentos: [{ ...ctx.agendamentos[0], status: "cancelado" as const }] };
    expect(validarAgendamento(prop("2026-11-03", "10:30", 60), c).erros).toEqual([]);
  });
  it("avisa fora da jornada ao atravessar o almoço", () => {
    expect(validarAgendamento(prop("2026-11-03", "11:30", 60), ctx).avisos).toEqual(["fora_da_jornada"]);
  });
  it("cabe até o fim do intervalo da jornada", () => {
    expect(validarAgendamento(prop("2026-11-03", "17:00", 60), ctx).avisos).toEqual([]);
    expect(validarAgendamento(prop("2026-11-03", "17:30", 60), ctx).avisos).toEqual(["fora_da_jornada"]);
  });
  it("dia sem jornada é fora da jornada", () => {
    expect(validarAgendamento(prop("2026-11-05", "10:00", 30), ctx).avisos).toEqual(["fora_da_jornada"]);
  });
  it("atravessar a meia-noite em São Paulo é fora da jornada", () => {
    const c = { ...ctx, jornadas: [{ diaSemana: 2, horaInicio: "00:00", horaFim: "23:59" }] };
    expect(validarAgendamento(prop("2026-11-03", "23:30", 60), c).avisos).toEqual(["fora_da_jornada"]);
  });
  it("detecta bloqueio", () => {
    expect(validarAgendamento(prop("2026-11-04", "10:00", 30), ctx).erros).toContain("bloqueio");
  });
  it("bloqueio encostado não conta", () => {
    expect(validarAgendamento(prop("2026-11-03", "23:30", 30), ctx).erros).not.toContain("bloqueio");
  });
  it("detecta serviço não realizado", () => {
    expect(
      validarAgendamento({ inicio: sp("2026-11-03", "14:00"), duracaoMin: 30, servicoId: "s2" }, ctx).erros,
    ).toContain("servico_nao_realizado");
  });
  it("tem mensagem para cada código", () => {
    expect(MENSAGEM_VALIDACAO.sobreposicao).toBe("Este horário já está ocupado para esta profissional.");
    expect(MENSAGEM_VALIDACAO.bloqueio).toBe("A profissional está de folga ou férias neste horário.");
    expect(MENSAGEM_VALIDACAO.servico_nao_realizado).toBe("Esta profissional não realiza este serviço.");
    expect(MENSAGEM_VALIDACAO.fora_da_jornada).toBe(
      "Fora do horário de trabalho da profissional. Deseja encaixar mesmo assim?",
    );
  });
});
