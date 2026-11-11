import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { conteudoDoPdf as conteudo } from "@/test/pdf-texto";
import { gerarPdfRelatorio, type DadosRelatorioPdf } from "./pdf-relatorio";

const base: DadosRelatorioPdf = {
  aba: "pagar",
  periodoRotulo: "Novembro de 2026 (01/11/2026 a 30/11/2026)",
  filtros: ["Situação: Em aberto", "Categoria: Aluguel"],
  geradoPor: "Fernanda",
  geradoEm: new Date("2026-11-10T13:05:00Z"),
  colunas: ["Descrição", "Categoria", "Vencimento", "Valor", "Situação"],
  linhas: Array.from({ length: 300 }, (_, i) => [
    `Conta ${i + 1}`,
    "Aluguel",
    "15/11/2026",
    "R$ 1.234,56",
    "Em aberto",
  ]),
  totais: [
    ["Contas", "300"],
    ["Total", "R$ 370.368,00"],
  ],
};

describe("gerarPdfRelatorio", () => {
  it("300 linhas: várias páginas, cabeçalho da tabela repetido e rodapé Página N de M", async () => {
    const pdf = await gerarPdfRelatorio(base);
    const { paginas, texto, imagens } = await conteudo(pdf);
    expect(paginas.length).toBeGreaterThanOrEqual(2);
    for (const [i, p] of paginas.entries()) {
      expect(p).toContain(`Página ${i + 1} de ${paginas.length}`);
      expect(p).toContain("Descrição"); // cabeçalho da tabela em toda página
    }
    expect(texto).toContain("Conta 1\n");
    expect(texto).toContain("Conta 300\n");
    expect(imagens).toBe(1); // logo, só na primeira página
  });

  it("traz clínica, título da aba, período, filtros, quem gerou e totais", async () => {
    const { texto } = await conteudo(await gerarPdfRelatorio(base));
    for (const esperado of [
      "Madame Fê Clinic",
      "Contas a pagar",
      "Período: Novembro de 2026 (01/11/2026 a 30/11/2026)",
      "Situação: Em aberto",
      "Categoria: Aluguel",
      "Gerado em 10/11/2026 10:05 por Fernanda",
      "Contas",
      "R$ 370.368,00",
    ]) {
      expect(texto).toContain(esperado);
    }
  });

  it("painel: os 7 cartões com os valores do resumo", async () => {
    const { texto } = await conteudo(
      await gerarPdfRelatorio({
        ...base,
        aba: "painel",
        filtros: [],
        cartoes: {
          recebido: 100000,
          recebidoQtd: 3,
          pago: 40000,
          pagoQtd: 2,
          aReceber: 25000,
          jaRecebido: 5000,
          aPagar: 10000,
          jaPago: 2000,
          aReceberVencido: 0,
          aPagarVencido: 0,
          vencidosQtd: 1,
          vencidosTotal: 7000,
        },
        linhas: [],
      }),
    );
    for (const esperado of [
      "Painel",
      "Recebido",
      "R$ 1.000,00",
      "Pago",
      "R$ 400,00",
      "Saldo em caixa",
      "R$ 600,00",
      "A receber",
      "R$ 250,00",
      "A pagar",
      "R$ 100,00",
      "Saldo projetado",
      "R$ 750,00",
      "Vencidos",
      "R$ 70,00",
      "Nada a listar com estes filtros.",
    ]) {
      expect(texto).toContain(esperado);
    }
  });

  it("painel: A receber / A pagar com a parte vencida", async () => {
    const { texto } = await conteudo(
      await gerarPdfRelatorio({
        ...base,
        aba: "painel",
        filtros: [],
        cartoes: {
          recebido: 0,
          recebidoQtd: 0,
          pago: 0,
          pagoQtd: 0,
          aReceber: 25000,
          jaRecebido: 0,
          aPagar: 10000,
          jaPago: 0,
          aReceberVencido: 4000,
          aPagarVencido: 0,
          vencidosQtd: 1,
          vencidosTotal: 4000,
        },
        linhas: [],
      }),
    );
    expect(texto).toContain("já recebido: R$ 0,00 · inclui R$ 40,00 vencidos");
    expect(texto).not.toContain("já pago: R$ 0,00 · inclui");
  });

  it("emoji e texto longo não quebram; o que não cabe na coluna é cortado", async () => {
    const pdf = await gerarPdfRelatorio({
      ...base,
      geradoPor: "Fê 😀",
      linhas: [["x".repeat(400), "Aluguel 😀", "15/11/2026", "R$ 1,00", "Em aberto"]],
    });
    const { paginas, texto } = await conteudo(pdf);
    expect(paginas).toHaveLength(1);
    expect(texto).toContain("por Fê ?");
    expect(texto).not.toContain("x".repeat(400));
  });
});
