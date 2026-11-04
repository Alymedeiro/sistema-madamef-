import { describe, expect, it } from "vitest";
import { combinarDataHora as sp } from "@/lib/dominio/tempo";
import {
  distribuirEmFaixas,
  faixasForaDaJornada,
  fimDaGrade,
  horaDaLinha,
  hrefAgenda,
  idDoHorario,
  lerIdDoHorario,
  navegar,
  linhasDoDia,
  parametrosAgenda,
  posicaoNaGrade,
  semanaDe,
  somarDias,
} from "./grade";

describe("linhasDoDia", () => {
  it("gera linhas de 15 min do início ao fim do funcionamento (fim exclusivo)", () => {
    const linhas = linhasDoDia([{ inicio: "09:00", fim: "10:00" }], 15);
    expect(linhas).toEqual(["09:00", "09:15", "09:30", "09:45"]);
  });

  it("cobre do primeiro início ao último fim, mesmo com intervalo no meio", () => {
    const linhas = linhasDoDia(
      [
        { inicio: "13:00", fim: "14:00" },
        { inicio: "09:00", fim: "12:00" },
      ],
      15,
    );
    expect(linhas[0]).toBe("09:00");
    expect(linhas.at(-1)).toBe("13:45");
    expect(linhas).toHaveLength(20);
  });

  it("arredonda horários quebrados para a grade", () => {
    expect(linhasDoDia([{ inicio: "09:10", fim: "09:50" }], 15)).toEqual([
      "09:00",
      "09:15",
      "09:30",
      "09:45",
    ]);
  });

  it("aceita horas do Postgres (HH:mm:ss)", () => {
    expect(linhasDoDia([{ inicio: "09:00:00", fim: "09:30:00" }], 15)).toEqual(["09:00", "09:15"]);
  });

  it("dia fechado não tem linhas", () => {
    expect(linhasDoDia([], 15)).toEqual([]);
  });

  it("fimDaGrade é a hora seguinte à última linha", () => {
    expect(fimDaGrade(["09:00", "09:15"], 15)).toBe("09:30");
    expect(fimDaGrade([], 15)).toBeNull();
  });
});

describe("posicaoNaGrade", () => {
  const linhas = linhasDoDia([{ inicio: "09:00", fim: "19:00" }], 15);

  it("calcula topo e altura em linhas, no fuso de São Paulo", () => {
    expect(posicaoNaGrade(sp("2026-11-03", "10:00"), sp("2026-11-03", "11:00"), "2026-11-03", linhas, 15)).toEqual({
      topo: 4,
      altura: 4,
    });
    expect(posicaoNaGrade(sp("2026-11-03", "09:30"), sp("2026-11-03", "10:15"), "2026-11-03", linhas, 15)).toEqual({
      topo: 2,
      altura: 3,
    });
  });

  it("corta o que passa das bordas da grade", () => {
    expect(posicaoNaGrade(sp("2026-11-03", "08:00"), sp("2026-11-03", "09:30"), "2026-11-03", linhas, 15)).toEqual({
      topo: 0,
      altura: 2,
    });
    expect(posicaoNaGrade(sp("2026-11-03", "18:30"), sp("2026-11-03", "20:00"), "2026-11-03", linhas, 15)).toEqual({
      topo: 38,
      altura: 2,
    });
  });

  it("devolve null quando nada aparece na grade do dia", () => {
    expect(posicaoNaGrade(sp("2026-11-03", "19:00"), sp("2026-11-03", "20:00"), "2026-11-03", linhas, 15)).toBeNull();
    expect(posicaoNaGrade(sp("2026-11-04", "10:00"), sp("2026-11-04", "11:00"), "2026-11-03", linhas, 15)).toBeNull();
    expect(posicaoNaGrade(sp("2026-11-03", "10:00"), sp("2026-11-03", "11:00"), "2026-11-03", [], 15)).toBeNull();
  });

  it("bloqueio de vários dias ocupa a grade inteira do dia", () => {
    expect(posicaoNaGrade(sp("2026-11-01", "00:00"), sp("2026-11-10", "00:00"), "2026-11-03", linhas, 15)).toEqual({
      topo: 0,
      altura: 40,
    });
  });
});

describe("horaDaLinha", () => {
  it("converte o índice da linha na hora", () => {
    const linhas = ["09:00", "09:15", "09:30"];
    expect(horaDaLinha(linhas, 2)).toBe("09:30");
    expect(horaDaLinha(linhas, 3)).toBeNull();
    expect(horaDaLinha(linhas, -1)).toBeNull();
  });
});

describe("faixasForaDaJornada", () => {
  it("devolve os trechos da grade sem jornada (antes, almoço e depois)", () => {
    expect(
      faixasForaDaJornada(
        [
          { inicio: "13:00:00", fim: "18:00:00" },
          { inicio: "09:30", fim: "12:00" },
        ],
        "09:00",
        "19:00",
      ),
    ).toEqual([
      { inicio: "09:00", fim: "09:30" },
      { inicio: "12:00", fim: "13:00" },
      { inicio: "18:00", fim: "19:00" },
    ]);
  });

  it("sem jornada no dia, a grade inteira fica fora", () => {
    expect(faixasForaDaJornada([], "09:00", "19:00")).toEqual([{ inicio: "09:00", fim: "19:00" }]);
  });

  it("jornada que cobre tudo não gera faixas", () => {
    expect(faixasForaDaJornada([{ inicio: "08:00", fim: "20:00" }], "09:00", "19:00")).toEqual([]);
  });
});

describe("distribuirEmFaixas", () => {
  const item = (id: string, ini: string, fim: string) => ({
    id,
    inicio: sp("2026-11-03", ini),
    fim: sp("2026-11-03", fim),
  });

  it("itens sem sobreposição ocupam a largura toda", () => {
    const r = distribuirEmFaixas([item("a", "09:00", "10:00"), item("b", "10:00", "11:00")]);
    expect(r.get("a")).toEqual({ faixa: 0, total: 1 });
    expect(r.get("b")).toEqual({ faixa: 0, total: 1 });
  });

  it("sobrepostos (ex.: cancelado e novo) dividem a largura", () => {
    const r = distribuirEmFaixas([
      item("a", "09:00", "10:00"),
      item("b", "09:30", "10:30"),
      item("c", "11:00", "12:00"),
    ]);
    expect(r.get("a")).toEqual({ faixa: 0, total: 2 });
    expect(r.get("b")).toEqual({ faixa: 1, total: 2 });
    expect(r.get("c")).toEqual({ faixa: 0, total: 1 });
  });
});

describe("datas", () => {
  it("somarDias atravessa mês e ano", () => {
    expect(somarDias("2026-11-30", 1)).toBe("2026-12-01");
    expect(somarDias("2026-12-31", 1)).toBe("2027-01-01");
    expect(somarDias("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("semanaDe começa na segunda e termina no domingo", () => {
    // 2026-11-04 é quarta.
    expect(semanaDe("2026-11-04")).toEqual([
      "2026-11-02",
      "2026-11-03",
      "2026-11-04",
      "2026-11-05",
      "2026-11-06",
      "2026-11-07",
      "2026-11-08",
    ]);
    // Domingo pertence à semana que começou na segunda anterior.
    expect(semanaDe("2026-11-08")[0]).toBe("2026-11-02");
  });
});

describe("parametrosAgenda", () => {
  const hoje = "2026-11-04";
  it("usa hoje e visão dia por padrão", () => {
    expect(parametrosAgenda({}, hoje)).toEqual({ data: hoje, visao: "dia", prof: null });
  });

  it("aceita valores válidos", () => {
    const prof = "5b0c1d52-3c4e-4f6a-8b7d-1a2b3c4d5e6f";
    expect(parametrosAgenda({ data: "2026-11-10", visao: "semana", prof }, hoje)).toEqual({
      data: "2026-11-10",
      visao: "semana",
      prof,
    });
  });

  it("ignora valores inválidos ou repetidos", () => {
    expect(parametrosAgenda({ data: "2026-02-30", visao: "mes", prof: "x" }, hoje)).toEqual({
      data: hoje,
      visao: "dia",
      prof: null,
    });
    expect(parametrosAgenda({ data: ["2026-11-10", "2026-11-11"] }, hoje).data).toBe(hoje);
  });
});

describe("navegação e alvos do arrastar", () => {
  it("monta o endereço da agenda", () => {
    expect(hrefAgenda({ data: "2026-11-03", visao: "dia" })).toBe("/agenda?data=2026-11-03&visao=dia");
    expect(hrefAgenda({ data: "2026-11-03", visao: "semana", prof: "p1" })).toBe(
      "/agenda?data=2026-11-03&visao=semana&prof=p1",
    );
  });

  it("anda um dia ou uma semana", () => {
    expect(navegar("2026-11-03", "dia", 1)).toBe("2026-11-04");
    expect(navegar("2026-11-03", "semana", -1)).toBe("2026-10-27");
  });

  it("id do horário vai e volta", () => {
    const id = idDoHorario("p1", "2026-11-03", "09:15");
    expect(lerIdDoHorario(id)).toEqual({ profissionalId: "p1", data: "2026-11-03", hora: "09:15" });
    expect(lerIdDoHorario("outra-coisa")).toBeNull();
  });
});
