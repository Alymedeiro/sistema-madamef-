import { describe, expect, it } from "vitest";
import {
  ETAPAS_ABERTAS,
  ETAPAS_LEAD,
  ROTULO_ETAPA_LEAD,
  aniversariantesEntre,
  dataRetorno,
  diasSemVir,
  ehSumida,
  situacaoRetorno,
  somarDias,
} from "./crm";

describe("dataRetorno", () => {
  it("usa o dia de São Paulo e soma os dias (virada do mês)", () => {
    expect(dataRetorno("2026-10-31T23:30:00-03:00", 1)).toBe("2026-11-01");
  });
  it("02:30Z ainda é o dia anterior em SP", () => {
    expect(dataRetorno("2026-11-01T02:30:00Z", 30)).toBe("2026-11-30");
  });
  it("aceita Date", () => {
    expect(dataRetorno(new Date("2026-12-20T15:00:00Z"), 15)).toBe("2027-01-04");
  });
});

describe("somarDias", () => {
  it("soma e subtrai atravessando mês e ano", () => {
    expect(somarDias("2026-12-30", 7)).toBe("2027-01-06");
    expect(somarDias("2026-03-01", -1)).toBe("2026-02-28");
  });
});

describe("situacaoRetorno", () => {
  it("antes de hoje é atrasado; hoje ou depois é da semana", () => {
    expect(situacaoRetorno("2026-11-11", "2026-11-12")).toBe("atrasado");
    expect(situacaoRetorno("2026-11-12", "2026-11-12")).toBe("semana");
    expect(situacaoRetorno("2026-11-19", "2026-11-12")).toBe("semana");
  });
});

describe("diasSemVir e ehSumida", () => {
  const hoje = "2026-11-12";
  const haDias = (n: number) => `${somarDias(hoje, -n)}T15:00:00Z`;
  it("conta dias de calendário em SP", () => {
    expect(diasSemVir(haDias(90), hoje)).toBe(90);
    expect(diasSemVir("2026-11-12T02:30:00Z", hoje)).toBe(1);
  });
  it("sumida só acima do limite (90 não, 91 sim)", () => {
    expect(ehSumida(haDias(89), hoje, 90)).toBe(false);
    expect(ehSumida(haDias(90), hoje, 90)).toBe(false);
    expect(ehSumida(haDias(91), hoje, 90)).toBe(true);
  });
  it("sem atendimento não é sumida", () => {
    expect(ehSumida(null, hoje, 90)).toBe(false);
  });
});

describe("aniversariantesEntre", () => {
  const cli = (id: string, nasc: string | null) => ({ id, data_nascimento: nasc });

  it("29/02 cai em 28/02 em ano não bissexto", () => {
    const r = aniversariantesEntre([cli("a", "2000-02-29")], "2027-02-26", "2027-03-02");
    expect(r).toEqual([{ id: "a", data_nascimento: "2000-02-29", dia: "2027-02-28", idade: 27 }]);
  });
  it("29/02 em ano bissexto fica em 29/02", () => {
    const r = aniversariantesEntre([cli("a", "2000-02-29")], "2028-02-27", "2028-03-01");
    expect(r[0]).toMatchObject({ dia: "2028-02-29", idade: 28 });
  });
  it("virada de ano: idade é a do ano de cada aniversário", () => {
    const r = aniversariantesEntre(
      [cli("d", "1990-12-30"), cli("j", "1985-01-02"), cli("x", "1990-06-01"), cli("n", null)],
      "2026-12-28",
      "2027-01-04",
    );
    expect(r.map((c) => [c.id, c.dia, c.idade])).toEqual([
      ["d", "2026-12-30", 36],
      ["j", "2027-01-02", 42],
    ]);
  });
  it("ordena por dia e depois mantém a ordem de entrada", () => {
    const r = aniversariantesEntre(
      [cli("b", "1990-11-14"), cli("a", "1991-11-12"), cli("c", "1992-11-14")],
      "2026-11-12",
      "2026-11-19",
    );
    expect(r.map((c) => c.id)).toEqual(["a", "b", "c"]);
  });
});

describe("etapas do lead", () => {
  it("rótulos e abertas", () => {
    expect(ETAPAS_LEAD).toEqual(["novo", "em_conversa", "orcamento_enviado", "agendou", "perdido"]);
    expect(ROTULO_ETAPA_LEAD).toEqual({
      novo: "Novo",
      em_conversa: "Em conversa",
      orcamento_enviado: "Orçamento enviado",
      agendou: "Agendou",
      perdido: "Perdido",
    });
    expect(ETAPAS_ABERTAS).toEqual(["novo", "em_conversa", "orcamento_enviado"]);
  });
});
