import { describe, expect, it } from "vitest";
import {
  atendimentosPorDia,
  montarAlertas,
  periodosDoMes,
  proximoAtendimento,
  semanaSegDom,
  serieDiaria,
  somarPeriodo,
  ticketMedio,
  variacaoPercentual,
} from "./indicadores";

describe("variacaoPercentual", () => {
  it("sem base (0 ou negativa) não compara", () => {
    expect(variacaoPercentual(5000, 0)).toBeNull();
    expect(variacaoPercentual(0, 0)).toBeNull();
  });
  it("positiva, negativa e arredondada para inteiro", () => {
    expect(variacaoPercentual(15000, 10000)).toBe(50);
    expect(variacaoPercentual(7500, 10000)).toBe(-25);
    expect(variacaoPercentual(10000, 10000)).toBe(0);
    expect(variacaoPercentual(10333, 10000)).toBe(3);
    expect(variacaoPercentual(10050, 10000)).toBe(1);
    expect(variacaoPercentual(0, 10000)).toBe(-100);
  });
});

describe("ticketMedio", () => {
  it("0 atendidos não divide por zero", () => {
    expect(ticketMedio(100000, 0)).toBeNull();
  });
  it("faturamento ÷ atendidos, em centavos inteiros", () => {
    expect(ticketMedio(100000, 4)).toBe(25000);
    expect(ticketMedio(10000, 3)).toBe(3333);
  });
});

describe("proximoAtendimento", () => {
  const agora = new Date("2026-11-12T15:00:00Z");
  const item = (id: string, inicio: string, status = "confirmado") => ({ id, inicio, status });
  it("é o primeiro com início a partir de agora, ignorando cancelado", () => {
    const itens = [
      item("a", "2026-11-12T12:00:00Z", "atendido"),
      item("b", "2026-11-12T15:30:00Z", "cancelado"),
      item("c", "2026-11-12T16:00:00Z", "pendente"),
      item("d", "2026-11-12T17:00:00Z"),
    ];
    expect(proximoAtendimento(itens, agora)?.id).toBe("c");
  });
  it("início exatamente agora conta; sem nenhum futuro devolve null", () => {
    expect(proximoAtendimento([item("x", "2026-11-12T15:00:00Z")], agora)?.id).toBe("x");
    expect(proximoAtendimento([item("y", "2026-11-12T10:00:00Z")], agora)).toBeNull();
    expect(proximoAtendimento([], agora)).toBeNull();
  });
});

describe("montarAlertas", () => {
  it("mantém só os de contagem > 0, com singular/plural e N na frente", () => {
    const r = montarAlertas([
      { id: "falhas", contagem: 0, singular: "mensagem com falha", plural: "mensagens com falha", href: "/a" },
      { id: "pend", contagem: 1, singular: "aguardando confirmação", plural: "aguardando confirmação", href: "/b" },
      { id: "sem", contagem: 3, singular: "atendido sem pagamento", plural: "atendidos sem pagamento", href: "/c" },
      { id: "zap", contagem: 1, singular: "WhatsApp desconectado", plural: "WhatsApp desconectado", href: "/d", semNumero: true },
    ]);
    expect(r.map((a) => a.texto)).toEqual([
      "1 aguardando confirmação",
      "3 atendidos sem pagamento",
      "WhatsApp desconectado",
    ]);
  });
  it("nenhum alerta devolve lista vazia", () => {
    expect(montarAlertas([{ id: "x", contagem: 0, singular: "a", plural: "b", href: "/" }])).toEqual([]);
  });
});

describe("serieDiaria", () => {
  it("30 dias terminando hoje, dias sem movimento com 0", () => {
    const s = serieDiaria([{ dia: "2026-11-12", valor: 500 }, { dia: "2026-10-14", valor: 200 }], "2026-10-14", "2026-11-12");
    expect(s).toHaveLength(30);
    expect(s[0]).toEqual({ dia: "2026-10-14", valor: 200 });
    expect(s[29]).toEqual({ dia: "2026-11-12", valor: 500 });
    expect(s[10]).toEqual({ dia: "2026-10-24", valor: 0 });
  });
  it("soma linhas repetidas do mesmo dia e ignora dias fora da janela", () => {
    const s = serieDiaria(
      [{ dia: "2026-11-11", valor: 100 }, { dia: "2026-11-11", valor: 50 }, { dia: "2026-01-01", valor: 9 }],
      "2026-11-10",
      "2026-11-12",
    );
    expect(s).toEqual([
      { dia: "2026-11-10", valor: 0 },
      { dia: "2026-11-11", valor: 150 },
      { dia: "2026-11-12", valor: 0 },
    ]);
  });
});

describe("semanaSegDom", () => {
  it("quarta: segunda a domingo da semana", () => {
    expect(semanaSegDom("2026-11-11")).toEqual([
      "2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15",
    ]);
  });
  it("domingo pertence à semana que termina nele", () => {
    expect(semanaSegDom("2026-11-15")[0]).toBe("2026-11-09");
    expect(semanaSegDom("2026-11-15")[6]).toBe("2026-11-15");
  });
  it("virada de mês: quinta 01/10/2026 começa em 28/09 e vai até 04/10", () => {
    const s = semanaSegDom("2026-10-01");
    expect(s[0]).toBe("2026-09-28");
    expect(s[6]).toBe("2026-10-04");
  });
});

describe("periodosDoMes", () => {
  it("mesmo dia do mês anterior", () => {
    expect(periodosDoMes("2026-11-12")).toEqual({
      inicioMes: "2026-11-01",
      inicioMesAnterior: "2026-10-01",
      fimMesAnterior: "2026-10-12",
    });
  });
  it("mês anterior mais curto limita ao último dia; janeiro volta para dezembro", () => {
    expect(periodosDoMes("2026-03-31").fimMesAnterior).toBe("2026-02-28");
    expect(periodosDoMes("2026-01-15")).toEqual({
      inicioMes: "2026-01-01",
      inicioMesAnterior: "2025-12-01",
      fimMesAnterior: "2025-12-15",
    });
  });
});

describe("somarPeriodo e atendimentosPorDia", () => {
  it("soma só o intervalo (inclusive)", () => {
    const linhas = [
      { dia: "2026-10-01", valor: 1 },
      { dia: "2026-10-02", valor: 2 },
      { dia: "2026-10-03", valor: 4 },
    ];
    expect(somarPeriodo(linhas, "2026-10-02", "2026-10-03")).toBe(6);
  });
  it("agrupa instantes pelo dia de São Paulo", () => {
    const r = atendimentosPorDia(
      ["2026-11-10T02:30:00Z", "2026-11-10T13:00:00Z", "2026-11-12T12:00:00Z"],
      ["2026-11-09", "2026-11-10", "2026-11-11"],
    );
    expect(r).toEqual([1, 1, 0]);
  });
});
