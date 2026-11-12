import { describe, expect, it } from "vitest";
import type { ResumoConversa } from "@/app/(app)/mensagens/dados";
import { filtrarConversas, lerFiltro } from "./filtro-conversas";

const conv = (o: Partial<ResumoConversa> & { chave: string }): ResumoConversa => ({
  clienteId: o.chave,
  nome: "Ana Souza",
  telefone: "5511987654321",
  ultima: { texto: "Oi", quando: "2026-11-10T12:00:00Z", direcao: "recebida" },
  naoLidas: 0,
  idsNaoLidos: [],
  classificacao: null,
  falhou: false,
  enviadas: [],
  ...o,
});

const ana = conv({
  chave: "c1",
  falhou: true,
  naoLidas: 1,
  idsNaoLidos: ["r1"],
  classificacao: "quer_remarcar",
  enviadas: [
    { status: "enviada", tipo: "lembrete" },
    { status: "falhou", tipo: "confirmacao" },
  ],
});
const bia = conv({
  chave: "c2",
  nome: "Bia Álvares",
  telefone: "5521999990000",
  classificacao: "confirmou",
  enviadas: [{ status: "pendente", tipo: "lembrete" }],
});
const sem = conv({ chave: "5531955554444", clienteId: null, nome: null, telefone: "5531955554444" });
const todas = [ana, bia, sem];
const chaves = (l: ResumoConversa[]) => l.map((c) => c.chave);

describe("filtrarConversas", () => {
  it("sem filtro devolve tudo", () => {
    expect(filtrarConversas(todas, {})).toHaveLength(3);
  });

  it("status: conversas com pelo menos uma mensagem enviada naquele status", () => {
    expect(chaves(filtrarConversas(todas, { status: "falhou" }))).toEqual(["c1"]);
    expect(chaves(filtrarConversas(todas, { status: "pendente" }))).toEqual(["c2"]);
  });

  it("status falhou ignora conversas cuja falha já foi reenviada", () => {
    const reenviada = conv({
      chave: "c9",
      falhou: false,
      enviadas: [
        { status: "falhou", tipo: "lembrete" },
        { status: "enviada", tipo: "lembrete" },
      ],
    });
    expect(chaves(filtrarConversas([ana, reenviada], { status: "falhou" }))).toEqual(["c1"]);
    expect(chaves(filtrarConversas([reenviada], { status: "enviada" }))).toEqual(["c9"]);
  });

  it("tipo: pelo menos uma mensagem daquele tipo", () => {
    expect(chaves(filtrarConversas(todas, { tipo: "lembrete" }))).toEqual(["c1", "c2"]);
  });

  it("status e tipo juntos exigem a mesma mensagem", () => {
    expect(chaves(filtrarConversas(todas, { status: "falhou", tipo: "lembrete" }))).toEqual([]);
    expect(chaves(filtrarConversas(todas, { status: "falhou", tipo: "confirmacao" }))).toEqual([
      "c1",
    ]);
  });

  it("busca por nome sem acento e por pedaço do telefone", () => {
    expect(chaves(filtrarConversas(todas, { busca: "alvares" }))).toEqual(["c2"]);
    expect(chaves(filtrarConversas(todas, { busca: "ANA" }))).toEqual(["c1"]);
    expect(chaves(filtrarConversas(todas, { busca: "5555-4444" }))).toEqual(["5531955554444"]);
    expect(chaves(filtrarConversas(todas, { busca: "31955554444" }))).toEqual(["5531955554444"]);
  });

  it("busca curta demais é ignorada", () => {
    expect(filtrarConversas(todas, { busca: "a" })).toHaveLength(3);
  });

  it("leitura: não lidas, quer remarcar e confirmou", () => {
    expect(chaves(filtrarConversas(todas, { leitura: "nao_lidas" }))).toEqual(["c1"]);
    expect(chaves(filtrarConversas(todas, { leitura: "quer_remarcar" }))).toEqual(["c1"]);
    expect(chaves(filtrarConversas(todas, { leitura: "confirmou" }))).toEqual(["c2"]);
  });
});

describe("lerFiltro", () => {
  it("lê status, tipo, busca e leitura válidos e descarta o resto", () => {
    expect(
      lerFiltro({ status: "falhou", tipo: "lembrete", busca: " Ana ", leitura: "nao_lidas" }),
    ).toEqual({ status: "falhou", tipo: "lembrete", busca: " Ana ", leitura: "nao_lidas" });
    expect(lerFiltro({ status: "x", tipo: "y", leitura: "z" })).toEqual({
      status: undefined,
      tipo: undefined,
      busca: "",
      leitura: undefined,
    });
  });

  it("links antigos com ?aba= continuam funcionando (a aba é ignorada)", () => {
    expect(lerFiltro({ aba: "fila", status: "falhou" }).status).toBe("falhou");
    expect(lerFiltro({ aba: "respostas" })).toMatchObject({ status: undefined, leitura: undefined });
  });

  it("?classificacao= antigo vira leitura", () => {
    expect(lerFiltro({ aba: "respostas", classificacao: "quer_remarcar" }).leitura).toBe(
      "quer_remarcar",
    );
    expect(lerFiltro({ classificacao: "confirmou" }).leitura).toBe("confirmou");
    expect(lerFiltro({ classificacao: "para_ler" }).leitura).toBe("nao_lidas");
  });

  it("aceita valores repetidos (usa o primeiro) e limita a busca a 100", () => {
    expect(lerFiltro({ status: ["falhou", "enviada"] }).status).toBe("falhou");
    expect(lerFiltro({ busca: "x".repeat(300) }).busca).toHaveLength(100);
  });
});
