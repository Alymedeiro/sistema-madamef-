import { describe, expect, it } from "vitest";
import {
  agrupamento,
  avisosPendentes,
  consultaDaSituacao,
  inicioDaContaFixa,
  periodoDoFiltro,
  saldos,
  situacaoConta,
  vencimentoDaCompetencia,
  type ContaAviso,
} from "./financeiro";

const d = (s: string) => new Date(s);

describe("periodoDoFiltro", () => {
  const agora = d("2026-11-10T15:00:00Z");
  it("padrão é o mês atual", () => {
    expect(periodoDoFiltro({}, agora)).toEqual({
      filtro: "mes",
      de: "2026-11-01",
      ate: "2026-11-30",
      rotulo: "Novembro de 2026",
    });
  });
  it("mês passado cruzando o ano", () => {
    const r = periodoDoFiltro({ periodo: "mes_passado" }, d("2027-01-10T15:00:00Z"));
    expect([r.de, r.ate, r.rotulo]).toEqual(["2026-12-01", "2026-12-31", "Dezembro de 2026"]);
    expect(periodoDoFiltro({ periodo: "mes_passado" }, agora).rotulo).toBe("Outubro de 2026");
  });
  it("próximo mês cruzando o ano", () => {
    const r = periodoDoFiltro({ periodo: "proximo_mes" }, d("2026-12-20T15:00:00Z"));
    expect([r.de, r.ate]).toEqual(["2027-01-01", "2027-01-31"]);
  });
  it("ano e tudo", () => {
    expect(periodoDoFiltro({ periodo: "ano" }, agora)).toEqual({
      filtro: "ano",
      de: "2026-01-01",
      ate: "2026-12-31",
      rotulo: "2026",
    });
    expect(periodoDoFiltro({ periodo: "tudo" }, agora)).toEqual({
      filtro: "tudo",
      de: "2000-01-01",
      ate: "2031-11-10",
      rotulo: "Tudo",
    });
  });
  it("personalizado válido", () => {
    const r = periodoDoFiltro(
      { periodo: "personalizado", de: "2026-11-01", ate: "2026-11-15" },
      agora,
    );
    expect(r).toEqual({
      filtro: "personalizado",
      de: "2026-11-01",
      ate: "2026-11-15",
      rotulo: "01/11/2026 a 15/11/2026",
    });
  });
  it("personalizado invertido, inválido ou incompleto cai em mês", () => {
    for (const p of [
      { periodo: "personalizado", de: "2026-12-31", ate: "2026-01-01" },
      { periodo: "personalizado", de: "2026-02-30", ate: "2026-03-10" },
      { periodo: "personalizado", de: "2026-02-01" },
      { periodo: "bobagem" },
    ]) {
      const r = periodoDoFiltro(p, agora);
      expect([r.filtro, r.de, r.ate]).toEqual(["mes", "2026-11-01", "2026-11-30"]);
    }
  });
  it("usa o dia de São Paulo na virada", () => {
    const r = periodoDoFiltro({}, d("2026-12-01T02:30:00Z"));
    expect([r.de, r.ate]).toEqual(["2026-11-01", "2026-11-30"]);
  });
});

describe("agrupamento", () => {
  it("até 62 dias é dia, acima é mês", () => {
    expect(agrupamento("2026-01-01", "2026-03-03")).toBe("dia"); // 62 dias
    expect(agrupamento("2026-01-01", "2026-03-04")).toBe("mes"); // 63 dias
  });
});

describe("situacaoConta", () => {
  it("classifica", () => {
    expect(situacaoConta({ status: "paga", vencimento: "2020-01-01" }, "2026-11-10")).toBe("paga");
    expect(situacaoConta({ status: "cancelada", vencimento: "2020-01-01" }, "2026-11-10")).toBe(
      "cancelada",
    );
    expect(situacaoConta({ status: "aberta", vencimento: "2026-11-10" }, "2026-11-10")).toBe(
      "em_aberto",
    );
    expect(situacaoConta({ status: "aberta", vencimento: "2026-11-09" }, "2026-11-10")).toBe(
      "vencida",
    );
  });
});

describe("avisosPendentes", () => {
  const conta = (id: string, vencimento: string): ContaAviso => ({
    tipo: "pagar",
    id,
    nome: "Aluguel",
    valorCentavos: 100000,
    vencimento,
  });
  const hoje = "2026-11-10";
  const textos = (cs: ContaAviso[], l = new Set<string>()) =>
    avisosPendentes(cs, hoje, l).map((a) => a.texto);

  it("marcos exatos", () => {
    expect(textos([conta("a", "2026-11-17")])).toEqual(["vence em 7 dias"]);
    expect(textos([conta("a", "2026-11-13")])).toEqual(["vence em 3 dias"]);
    expect(textos([conta("a", "2026-11-11")])).toEqual(["vence amanhã"]);
    expect(textos([conta("a", "2026-11-10")])).toEqual(["vence hoje"]);
    expect(textos([conta("a", "2026-11-12")])).toEqual([]);
    expect(textos([conta("a", "2026-11-20")])).toEqual([]);
  });
  it("vencidas", () => {
    expect(textos([conta("a", "2026-11-09")])).toEqual(["vencida há 1 dia"]);
    expect(textos([conta("a", "2026-10-31")])).toEqual(["vencida há 10 dias"]);
  });
  it("chaves", () => {
    const [a] = avisosPendentes([conta("x", "2026-11-13")], hoje, new Set());
    expect(a.chave).toBe("pagar:x:3");
    expect(a.dias).toBe(3);
    const [v] = avisosPendentes([{ ...conta("y", "2026-11-05"), tipo: "receber" }], hoje, new Set());
    expect(v.chave).toBe("receber:y:vencida:2026-11-10");
    const [v2] = avisosPendentes([conta("y", "2026-11-05")], "2026-11-11", new Set());
    expect(v2.chave).toBe("pagar:y:vencida:2026-11-11");
  });
  it("lidas não aparecem e ordena por vencimento", () => {
    expect(textos([conta("x", "2026-11-13")], new Set(["pagar:x:3"]))).toEqual([]);
    const r = avisosPendentes(
      [conta("b", "2026-11-17"), conta("a", "2026-11-05"), conta("c", "2026-11-10")],
      hoje,
      new Set(),
    );
    expect(r.map((x) => x.conta.id)).toEqual(["a", "c", "b"]);
  });
});

describe("vencimentoDaCompetencia", () => {
  it("limita ao último dia do mês", () => {
    expect(vencimentoDaCompetencia("2028-02-01", 31)).toBe("2028-02-29");
    expect(vencimentoDaCompetencia("2027-02-01", 31)).toBe("2027-02-28");
    expect(vencimentoDaCompetencia("2026-11-01", 31)).toBe("2026-11-30");
    expect(vencimentoDaCompetencia("2026-11-01", 5)).toBe("2026-11-05");
  });
});

describe("saldos", () => {
  it("calcula caixa e projetado", () => {
    expect(saldos({ recebido: 1000, pago: 400, aReceber: 300, aPagar: 500 })).toEqual({
      saldoCaixa: 600,
      saldoProjetado: 400,
    });
  });
});

describe("consultaDaSituacao", () => {
  const hoje = "2026-11-10";
  const mes = { de: "2026-11-01", ate: "2026-11-30" };

  it("em aberto: vencimento de max(de, hoje) até ate — sem as vencidas", () => {
    expect(consultaDaSituacao("aberta", mes, hoje)).toEqual({
      status: "aberta",
      coluna: "vencimento",
      gte: hoje,
      lte: "2026-11-30",
      lt: null,
    });
  });

  it("mês passado em aberto fica vazio (gte > lte); próximo mês só o próximo mês", () => {
    const passado = consultaDaSituacao("aberta", { de: "2026-10-01", ate: "2026-10-31" }, hoje);
    expect(passado.gte! > passado.lte!).toBe(true);
    expect(consultaDaSituacao("aberta", { de: "2026-12-01", ate: "2026-12-31" }, hoje)).toMatchObject({
      gte: "2026-12-01",
      lte: "2026-12-31",
      lt: null,
    });
  });

  it("vencidas ignoram o período; pagas pela data do pagamento; canceladas e todas por vencimento", () => {
    expect(consultaDaSituacao("vencida", mes, hoje)).toEqual({
      status: "aberta",
      coluna: "vencimento",
      gte: null,
      lte: null,
      lt: hoje,
    });
    expect(consultaDaSituacao("paga", mes, hoje)).toMatchObject({ status: "paga", coluna: "pagamento", gte: mes.de, lte: mes.ate });
    expect(consultaDaSituacao("cancelada", mes, hoje)).toMatchObject({ status: "cancelada", coluna: "vencimento", gte: mes.de });
    expect(consultaDaSituacao("todas", mes, hoje)).toMatchObject({ status: null, gte: mes.de, lte: mes.ate });
  });
});

describe("inicioDaContaFixa", () => {
  it("dia ainda por vir (ou hoje) começa neste mês", () => {
    expect(inicioDaContaFixa(10, "2026-11-10")).toBe("2026-11-01");
    expect(inicioDaContaFixa(31, "2026-11-30")).toBe("2026-11-01"); // 31 → 30/11
  });

  it("dia que já passou começa no próximo mês, com virada de ano", () => {
    expect(inicioDaContaFixa(9, "2026-11-10")).toBe("2026-12-01");
    expect(inicioDaContaFixa(5, "2026-12-20")).toBe("2027-01-01");
  });
});
