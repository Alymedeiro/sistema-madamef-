import { beforeEach, describe, expect, it, vi } from "vitest";
import { criarSupabaseFalso } from "@/test/supabase-falso";

vi.mock("server-only", () => ({}));

import {
  agruparConversas,
  carregarConversas,
  filtrarPorClassificacao,
  type LinhaConversaEnviada,
  type LinhaConversaRecebida,
} from "./dados";

const rec = (o: Partial<LinhaConversaRecebida> & { id: string }): LinhaConversaRecebida => ({
  telefone: "5511987654321",
  texto: "Oi",
  recebida_em: "2026-11-10T12:00:00Z",
  classificacao: "para_ler",
  lida_em: null,
  cliente_id: "c1",
  clientes: { nome: "Ana Souza" },
  ...o,
});
const env = (o: Partial<LinhaConversaEnviada> & { id: string }): LinhaConversaEnviada => ({
  telefone: "5511987654321",
  texto: "Olá",
  status: "enviada",
  tipo: "avulsa",
  enviada_em: "2026-11-10T13:00:00Z",
  agendado_para: "2026-11-10T13:00:00Z",
  cliente_id: "c1",
  ...o,
});

describe("agruparConversas", () => {
  it("várias mensagens da mesma cliente viram uma conversa", () => {
    const r = agruparConversas(
      [
        rec({ id: "r1", recebida_em: "2026-11-10T10:00:00Z", texto: "a" }),
        rec({ id: "r2", recebida_em: "2026-11-10T11:00:00Z", texto: "b" }),
      ],
      [],
    );
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({
      chave: "c1",
      clienteId: "c1",
      nome: "Ana Souza",
      ultima: { texto: "b", quando: "2026-11-10T11:00:00Z", direcao: "recebida" },
    });
  });

  it("ordena pela última mensagem, mais recente no topo", () => {
    const r = agruparConversas(
      [
        rec({ id: "r1", cliente_id: "c1", recebida_em: "2026-11-10T10:00:00Z" }),
        rec({
          id: "r2",
          cliente_id: "c2",
          recebida_em: "2026-11-10T12:00:00Z",
          clientes: { nome: "Bia" },
        }),
      ],
      [env({ id: "e1", cliente_id: "c1", enviada_em: "2026-11-10T14:00:00Z" })],
    );
    expect(r.map((c) => c.chave)).toEqual(["c1", "c2"]);
  });

  it("conta não lidas só das recebidas e guarda os ids", () => {
    const [c] = agruparConversas(
      [
        rec({ id: "r1" }),
        rec({ id: "r2", lida_em: "2026-11-10T12:30:00Z" }),
        rec({ id: "r3", recebida_em: "2026-11-10T12:10:00Z" }),
      ],
      [env({ id: "e1" })],
    );
    expect(c.naoLidas).toBe(2);
    expect([...c.idsNaoLidos].sort()).toEqual(["r1", "r3"]);
  });

  it("a prévia é a última mensagem enviada quando ela é a mais nova; automática usa o rótulo", () => {
    const [a] = agruparConversas([rec({ id: "r1" })], [env({ id: "e1", texto: "Combinado" })]);
    expect(a.ultima).toEqual({
      texto: "Combinado",
      quando: "2026-11-10T13:00:00Z",
      direcao: "enviada",
    });
    const [b] = agruparConversas(
      [rec({ id: "r1" })],
      [env({ id: "e1", texto: null, tipo: "confirmacao" })],
    );
    expect(b.ultima.texto).toMatch(/^\(mensagem automática: /);
  });

  it("ignora enviadas canceladas ou com falha na prévia", () => {
    const [c] = agruparConversas(
      [rec({ id: "r1" })],
      [env({ id: "e1", status: "falhou" }), env({ id: "e2", status: "cancelada" })],
    );
    expect(c.ultima.direcao).toBe("recebida");
  });

  it("pendente com horário futuro não vira a última nem ordena; vencida ou enviada sim", () => {
    const agora = new Date("2026-11-10T14:00:00Z");
    const recs = [rec({ id: "r1", recebida_em: "2026-11-10T10:00:00Z" })];
    const [a] = agruparConversas(
      recs,
      [
        env({
          id: "e1",
          status: "pendente",
          enviada_em: null,
          agendado_para: "2026-11-11T09:00:00Z",
        }),
      ],
      agora,
    );
    expect(a.ultima.direcao).toBe("recebida");
    const [b] = agruparConversas(
      recs,
      [
        env({
          id: "e2",
          status: "enviando",
          enviada_em: null,
          agendado_para: "2026-11-10T13:00:00Z",
        }),
      ],
      agora,
    );
    expect(b.ultima.direcao).toBe("enviada");
    const outra = rec({ id: "r9", cliente_id: "c2", recebida_em: "2026-11-10T12:00:00Z" });
    const r = agruparConversas(
      [...recs, outra],
      [
        env({
          id: "e3",
          status: "pendente",
          enviada_em: null,
          agendado_para: "2026-11-12T09:00:00Z",
        }),
      ],
      agora,
    );
    expect(r.map((c) => c.chave)).toEqual(["c2", "c1"]);
  });

  it("telefone sem cliente vira conversa separada, com chave = telefone", () => {
    const r = agruparConversas(
      [
        rec({ id: "r1", cliente_id: null, clientes: null, telefone: "5511911112222" }),
        rec({ id: "r2", cliente_id: null, clientes: null, telefone: "5511933334444" }),
        rec({ id: "r3", cliente_id: null, clientes: null, telefone: "5511911112222" }),
      ],
      [
        env({
          id: "e1",
          cliente_id: null,
          telefone: "5511933334444",
          enviada_em: "2026-11-10T20:00:00Z",
        }),
      ],
    );
    expect(r.map((c) => c.chave).sort()).toEqual(["5511911112222", "5511933334444"]);
    const sem = r.find((c) => c.chave === "5511933334444")!;
    expect(sem).toMatchObject({ clienteId: null, nome: null, telefone: "5511933334444" });
    expect(sem.ultima.direcao).toBe("enviada");
  });

  it("mesma cliente com telefones diferentes fica numa conversa", () => {
    const r = agruparConversas(
      [
        rec({ id: "r1", telefone: "5511900000001", recebida_em: "2026-11-10T10:00:00Z" }),
        rec({ id: "r2", telefone: "5511900000002", recebida_em: "2026-11-10T11:00:00Z" }),
      ],
      [],
    );
    expect(r).toHaveLength(1);
    expect(r[0].telefone).toBe("5511900000002");
  });

  it("a classificação é a da última recebida", () => {
    const [c] = agruparConversas(
      [
        rec({ id: "r1", classificacao: "quer_remarcar", recebida_em: "2026-11-10T10:00:00Z" }),
        rec({ id: "r2", classificacao: "confirmou", recebida_em: "2026-11-10T11:00:00Z" }),
      ],
      [env({ id: "e1", enviada_em: "2026-11-10T15:00:00Z" })],
    );
    expect(c.classificacao).toBe("confirmou");
  });

  it("enviadas de quem não tem recebida não criam conversa", () => {
    expect(agruparConversas([], [env({ id: "e1" })])).toEqual([]);
  });
});

describe("filtrarPorClassificacao", () => {
  it("filtra conversas pela classificação da última recebida", () => {
    const todas = agruparConversas(
      [
        rec({ id: "r1", cliente_id: "c1", classificacao: "para_ler" }),
        rec({ id: "r2", cliente_id: "c2", classificacao: "confirmou", clientes: { nome: "Bia" } }),
      ],
      [],
    );
    expect(filtrarPorClassificacao(todas, "confirmou").map((c) => c.chave)).toEqual(["c2"]);
    expect(filtrarPorClassificacao(todas, null)).toHaveLength(2);
  });

  it("'Para ler' exige não lidas na conversa", () => {
    const todas = agruparConversas(
      [
        rec({ id: "r1", cliente_id: "c1", classificacao: "para_ler" }),
        rec({
          id: "r2",
          cliente_id: "c2",
          classificacao: "para_ler",
          lida_em: "2026-11-10T13:00:00Z",
          clientes: { nome: "Bia" },
        }),
      ],
      [],
    );
    expect(filtrarPorClassificacao(todas, "para_ler").map((c) => c.chave)).toEqual(["c1"]);
  });
});

describe("carregarConversas", () => {
  let falso = criarSupabaseFalso();
  beforeEach(() => {
    falso = criarSupabaseFalso();
    falso.definirPadrao({ data: null, error: null });
  });

  it("lê recebidas e enviadas e devolve conversas filtradas", async () => {
    falso.responder("mensagens_recebidas", {
      data: [rec({ id: "r1" }), rec({ id: "r2", cliente_id: "c2", classificacao: "confirmou" })],
      error: null,
    });
    falso.responder("fila_mensagens", { data: [env({ id: "e1" })], error: null });
    const r = await carregarConversas(falso.cliente as never, { classificacao: "para_ler" });
    expect(r.map((c) => c.chave)).toEqual(["c1"]);
    expect(r[0].ultima.direcao).toBe("enviada");
  });

  it("erro do banco lança", async () => {
    falso.responder("mensagens_recebidas", { data: null, error: { message: "boom" } });
    await expect(carregarConversas(falso.cliente as never)).rejects.toThrow("boom");
  });
});
