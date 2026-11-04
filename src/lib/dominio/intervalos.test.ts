import { describe, expect, it } from "vitest";
import {
  agruparJornadasPorDia,
  erroDeIntervalos,
  achatarJornadasPorDia,
  horarioDoBanco,
  ORDEM_DIAS,
} from "./intervalos";

describe("erroDeIntervalos", () => {
  it("aceita vazio, um intervalo e intervalos encostados", () => {
    expect(erroDeIntervalos([])).toBeNull();
    expect(erroDeIntervalos([{ inicio: "09:00", fim: "18:00" }])).toBeNull();
    expect(
      erroDeIntervalos([
        { inicio: "12:00", fim: "14:00" },
        { inicio: "09:00", fim: "12:00" },
      ]),
    ).toBeNull();
  });

  it("detecta fim <= início, sobreposição (em qualquer ordem) e formato", () => {
    expect(erroDeIntervalos([{ inicio: "10:00", fim: "10:00" }])).toMatch(/depois/);
    expect(erroDeIntervalos([{ inicio: "10:00", fim: "09:00" }])).toMatch(/depois/);
    expect(
      erroDeIntervalos([
        { inicio: "13:00", fim: "16:00" },
        { inicio: "09:00", fim: "14:00" },
      ]),
    ).toMatch(/sobrepor/);
    expect(erroDeIntervalos([{ inicio: "9:00", fim: "10:00" }])).toMatch(/HH:mm/);
    expect(erroDeIntervalos([{ inicio: "09:00", fim: "24:00" }])).toMatch(/HH:mm/);
  });
});

describe("conversões de jornada", () => {
  it("ORDEM_DIAS começa na segunda e termina no domingo", () => {
    expect(ORDEM_DIAS).toEqual([1, 2, 3, 4, 5, 6, 0]);
  });

  it("agrupa por dia (todos os 7 dias presentes) e achata de volta", () => {
    const linhas = [
      { diaSemana: 1, horaInicio: "13:00", horaFim: "18:00" },
      { diaSemana: 1, horaInicio: "09:00", horaFim: "12:00" },
      { diaSemana: 0, horaInicio: "10:00", horaFim: "14:00" },
    ];
    const porDia = agruparJornadasPorDia(linhas);
    expect(Object.keys(porDia).sort()).toEqual(["0", "1", "2", "3", "4", "5", "6"]);
    expect(porDia["1"]).toEqual([
      { inicio: "09:00", fim: "12:00" },
      { inicio: "13:00", fim: "18:00" },
    ]);
    expect(porDia["2"]).toEqual([]);

    const achatado = achatarJornadasPorDia(porDia);
    expect(achatado).toHaveLength(3);
    expect(achatado).toContainEqual({ diaSemana: 0, horaInicio: "10:00", horaFim: "14:00" });
  });

  it("aceita horas com segundos vindas do Postgres (09:00:00)", () => {
    const porDia = agruparJornadasPorDia([
      { diaSemana: 3, horaInicio: "09:00:00", horaFim: "18:00:00" },
    ]);
    expect(porDia["3"]).toEqual([{ inicio: "09:00", fim: "18:00" }]);
  });
});

describe("horarioDoBanco", () => {
  it("lê o jsonb e completa dias ausentes como fechados", () => {
    const h = horarioDoBanco({ "1": [{ inicio: "09:00", fim: "19:00" }], "0": [] });
    expect(h["1"]).toEqual([{ inicio: "09:00", fim: "19:00" }]);
    expect(h["0"]).toEqual([]);
    expect(h["6"]).toEqual([]);
  });

  it("ignora valores malformados sem lançar erro", () => {
    expect(horarioDoBanco(null)["1"]).toEqual([]);
    expect(horarioDoBanco([])["1"]).toEqual([]);
    expect(horarioDoBanco({ "1": "aberto", "2": [{ inicio: 9 }] })["1"]).toEqual([]);
    expect(horarioDoBanco({ "2": [{ inicio: 9 }] })["2"]).toEqual([]);
  });
});
