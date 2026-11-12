import { beforeEach, describe, expect, it, vi } from "vitest";
import { criarSupabaseFalso } from "@/test/supabase-falso";

vi.mock("server-only", () => ({}));

import {
  agruparConversas,
  carregarConversas,
  chaveTelefone,
  formasTelefone,
  marcarArquivadas,
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

  it("mensagens avulsas para lead agrupam pelo telefone, com o nome do lead", () => {
    const r = agruparConversas(
      [],
      [
        env({
          id: "e1",
          cliente_id: null,
          lead_id: "l1",
          leads: { nome: "Lia Lead" },
          clientes: null,
          telefone: "5511955556666",
        }),
        env({
          id: "e2",
          cliente_id: null,
          lead_id: "l1",
          leads: { nome: "Lia Lead" },
          clientes: null,
          telefone: "5511955556666",
          tipo: "robo",
          enviada_em: "2026-11-10T14:00:00Z",
          agendado_para: "2026-11-10T14:00:00Z",
        }),
      ],
    );
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({
      chave: "5511955556666",
      clienteId: null,
      leadId: "l1",
      nome: "Lia Lead",
    });
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

  it("cliente só com enviadas/agendadas abre conversa (sem classificação)", () => {
    const [c] = agruparConversas([], [env({ id: "e1", tipo: "lembrete" })]);
    expect(c).toMatchObject({
      chave: "c1",
      clienteId: "c1",
      telefone: "5511987654321",
      classificacao: null,
      naoLidas: 0,
      ultima: { texto: "Olá", direcao: "enviada" },
      enviadas: [{ status: "enviada", tipo: "lembrete" }],
    });
  });

  it("conversa só de pedido online (sem cliente) agrupa pelo telefone", () => {
    const r = agruparConversas(
      [],
      [
        env({ id: "e1", cliente_id: null, telefone: "5511900001111", clientes: null }),
        env({ id: "e2", cliente_id: null, telefone: "5511900001111", clientes: null }),
      ],
    );
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ chave: "5511900001111", clienteId: null, nome: null });
  });

  it("só com futuras: aparece e conta para os filtros, mas a prévia usa a mais próxima", () => {
    const agora = new Date("2026-11-10T12:00:00Z");
    const [c] = agruparConversas(
      [],
      [
        env({
          id: "e1",
          status: "pendente",
          tipo: "lembrete",
          enviada_em: null,
          agendado_para: "2026-11-12T12:00:00Z",
          texto: null,
        }),
      ],
      agora,
    );
    expect(c.enviadas).toEqual([{ status: "pendente", tipo: "lembrete" }]);
    expect(c.ultima.texto).toBe("(mensagem automática: Lembrete)");
  });

  it("futuras não contam para a prévia nem para a ordem quando já houve mensagem", () => {
    const agora = new Date("2026-11-10T12:00:00Z");
    const [c] = agruparConversas(
      [rec({ id: "r1", recebida_em: "2026-11-10T10:00:00Z", texto: "Oi" })],
      [
        env({
          id: "e1",
          status: "pendente",
          enviada_em: null,
          agendado_para: "2026-11-15T12:00:00Z",
        }),
      ],
      agora,
    );
    expect(c.ultima).toMatchObject({ texto: "Oi", direcao: "recebida" });
    expect(c.enviadas).toHaveLength(1);
  });

  it("falhou: selo quando há falha sem reenvio posterior", () => {
    const base = { tipo: "lembrete" as const, agendamento_id: "a1", pedido_online_id: null };
    const [c] = agruparConversas(
      [],
      [env({ id: "e1", ...base, status: "falhou", criado_em: "2026-11-10T09:00:00Z" })],
    );
    expect(c.falhou).toBe(true);
  });

  it("falhou: selo some quando há reenvio posterior", () => {
    const base = { tipo: "lembrete" as const, agendamento_id: "a1", pedido_online_id: null };
    const [c] = agruparConversas(
      [],
      [
        env({ id: "e1", ...base, status: "falhou", criado_em: "2026-11-10T09:00:00Z" }),
        env({ id: "e2", ...base, status: "enviada", criado_em: "2026-11-10T10:00:00Z" }),
      ],
    );
    expect(c.falhou).toBe(false);
  });
});

describe("carregarConversas", () => {
  let falso = criarSupabaseFalso();
  beforeEach(() => {
    falso = criarSupabaseFalso();
    falso.definirPadrao({ data: null, error: null });
  });

  it("lê recebidas e enviadas, inclui quem só tem enviadas e aplica o filtro", async () => {
    falso.responder("mensagens_recebidas", {
      data: [rec({ id: "r1" }), rec({ id: "r2", cliente_id: "c2", classificacao: "confirmou" })],
      error: null,
    });
    falso.responder("fila_mensagens", {
      data: [env({ id: "e1" }), env({ id: "e2", cliente_id: "c3", clientes: { nome: "Carla" } })],
      error: null,
    });
    const todas = await carregarConversas(falso.cliente as never);
    expect(todas.map((c) => c.chave).sort()).toEqual(["c1", "c2", "c3"]);
    expect(todas.find((c) => c.chave === "c3")).toMatchObject({ nome: "Carla" });
    expect(falso.chamadasDe("fila_mensagens", "limit")[0].args).toEqual([2000]);
    expect(falso.chamadasDe("mensagens_recebidas", "limit")[0].args).toEqual([500]);
  });

  it("filtra por leitura", async () => {
    falso.responder("mensagens_recebidas", {
      data: [rec({ id: "r1" }), rec({ id: "r2", cliente_id: "c2", classificacao: "confirmou" })],
      error: null,
    });
    falso.responder("fila_mensagens", { data: [env({ id: "e1" })], error: null });
    const r = await carregarConversas(falso.cliente as never, { leitura: "confirmou" });
    expect(r.map((c) => c.chave)).toEqual(["c2"]);
  });

  it("erro do banco lança", async () => {
    falso.responder("mensagens_recebidas", { data: null, error: { message: "boom" } });
    await expect(carregarConversas(falso.cliente as never)).rejects.toThrow("boom");
  });
});

describe("número com e sem o 9 (sem cadastro)", () => {
  it("chaveTelefone e formasTelefone", () => {
    expect(chaveTelefone("551187654321")).toBe("5511987654321");
    expect(chaveTelefone("5511987654321")).toBe("5511987654321");
    expect(chaveTelefone("+1 555")).toBe("+1 555");
    expect(formasTelefone("551187654321")).toEqual(["551187654321", "5511987654321"]);
    expect(formasTelefone("5511987654321")).toEqual(["5511987654321", "551187654321"]);
    expect(formasTelefone("123")).toEqual(["123"]);
  });

  it("recebida de 12 dígitos e resposta do robô de 13 viram uma conversa só", () => {
    const r = agruparConversas(
      [rec({ id: "r1", telefone: "552188887777", cliente_id: null, clientes: null })],
      [
        env({
          id: "e1",
          telefone: "5521988887777",
          cliente_id: null,
          tipo: "robo",
          texto: "Menu",
          enviada_em: "2026-11-10T12:05:00Z",
          agendado_para: "2026-11-10T12:05:00Z",
        }),
      ],
      new Date("2026-11-10T13:00:00Z"),
    );
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({
      chave: "5521988887777",
      telefone: "552188887777",
      ultima: { texto: "Menu", direcao: "enviada" },
    });
  });
});

describe("marcarArquivadas (arquivada até chegar nova recebida)", () => {
  const base = () =>
    agruparConversas(
      [rec({ id: "r1", recebida_em: "2026-11-10T12:00:00Z" })],
      [env({ id: "e1", enviada_em: "2026-11-10T13:00:00Z" })],
    );
  const marca = (arquivada_em: string) => [{ chave: "c1", arquivada_em }];

  it("sem marca: não arquivada", () => {
    expect(marcarArquivadas(base(), [])[0].arquivada).toBe(false);
  });

  it("recebida antes de arquivar: oculta", () => {
    expect(marcarArquivadas(base(), marca("2026-11-10T14:00:00Z"))[0].arquivada).toBe(true);
  });

  it("recebida depois de arquivar: volta", () => {
    const conversas = agruparConversas(
      [
        rec({ id: "r1", recebida_em: "2026-11-10T12:00:00Z" }),
        rec({ id: "r2", recebida_em: "2026-11-10T15:00:00Z" }),
      ],
      [],
    );
    expect(marcarArquivadas(conversas, marca("2026-11-10T14:00:00Z"))[0].arquivada).toBe(false);
  });

  it("enviada depois de arquivar: continua oculta", () => {
    const conversas = agruparConversas(
      [rec({ id: "r1", recebida_em: "2026-11-10T12:00:00Z" })],
      [env({ id: "e2", enviada_em: "2026-11-10T16:00:00Z" })],
    );
    expect(marcarArquivadas(conversas, marca("2026-11-10T14:00:00Z"))[0].arquivada).toBe(true);
  });

  it("sem recebidas (só enviadas) e com marca: oculta", () => {
    const conversas = agruparConversas([], [env({ id: "e1" })]);
    expect(marcarArquivadas(conversas, marca("2026-11-01T00:00:00Z"))[0].arquivada).toBe(true);
  });

  it("a chave sem cadastro junta com e sem o 9", () => {
    const conversas = agruparConversas(
      [rec({ id: "r1", cliente_id: null, clientes: null, telefone: "551187654321" })],
      [],
    );
    expect(conversas[0].chave).toBe("5511987654321");
    expect(
      marcarArquivadas(conversas, [
        { chave: "5511987654321", arquivada_em: "2026-12-01T00:00:00Z" },
      ])[0].arquivada,
    ).toBe(true);
  });
});

describe("carregarConversas com arquivadas", () => {
  it("esconde arquivadas e as mostra no filtro Arquivadas", async () => {
    const montar = () => {
      const falso = criarSupabaseFalso();
      falso.definirPadrao({ data: null, error: null });
      falso.responder("mensagens_recebidas", {
        data: [rec({ id: "r1" }), rec({ id: "r2", cliente_id: "c2" })],
        error: null,
      });
      falso.responder("fila_mensagens", { data: [], error: null });
      falso.responder("conversas_arquivadas", {
        data: [{ chave: "c2", arquivada_em: "2026-11-11T00:00:00Z" }],
        error: null,
      });
      return falso;
    };
    const normal = await carregarConversas(montar().cliente as never);
    expect(normal.map((c) => c.chave)).toEqual(["c1"]);
    const arq = await carregarConversas(montar().cliente as never, { leitura: "arquivadas" });
    expect(arq.map((c) => c.chave)).toEqual(["c2"]);
  });
});
