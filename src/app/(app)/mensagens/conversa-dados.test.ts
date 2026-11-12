import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StatusMensagem, TipoMensagem } from "@/lib/dominio/whatsapp";
import { criarSupabaseFalso } from "@/test/supabase-falso";

vi.mock("server-only", () => ({}));

import { carregarConversa, montarConversa } from "./dados";

const ok = (data: unknown) => ({ data, error: null });
let falso = criarSupabaseFalso();

beforeEach(() => {
  falso = criarSupabaseFalso();
  falso.definirPadrao({ data: null, error: null });
});

const rec = (id: string, recebida_em: string, texto = "Oi") => ({ id, texto, recebida_em });
const env = (
  id: string,
  o: Partial<{
    texto: string | null;
    status: StatusMensagem;
    tipo: TipoMensagem;
    enviada_em: string | null;
    agendado_para: string;
  }> = {},
) => ({
  id,
  texto: "Olá" as string | null,
  status: "enviada" as StatusMensagem,
  tipo: "avulsa" as TipoMensagem,
  enviada_em: null as string | null,
  agendado_para: "2026-11-10T10:00:00Z",
  ...o,
});

describe("montarConversa", () => {
  it("junta e ordena por horário (enviada_em ?? agendado_para)", () => {
    const itens = montarConversa(
      [rec("r1", "2026-11-10T12:00:00Z"), rec("r2", "2026-11-10T08:00:00Z")],
      [
        env("e1", { enviada_em: "2026-11-10T11:00:00Z", agendado_para: "2026-11-10T07:00:00Z" }),
        env("e2", { agendado_para: "2026-11-10T09:00:00Z" }),
      ],
    );
    expect(itens.map((i) => i.id)).toEqual(["r2", "e2", "e1", "r1"]);
    expect(itens[0]).toMatchObject({ direcao: "recebida", quando: "2026-11-10T08:00:00Z" });
    expect(itens[2]).toMatchObject({ direcao: "enviada", status: "enviada", tipo: "avulsa" });
  });

  it("empate de horário mantém a ordem de entrada (recebidas antes)", () => {
    const t = "2026-11-10T10:00:00Z";
    const itens = montarConversa(
      [rec("r1", t)],
      [env("e1", { agendado_para: t }), env("e2", { agendado_para: t })],
    );
    expect(itens.map((i) => i.id)).toEqual(["r1", "e1", "e2"]);
  });

  it("corta nas últimas 100", () => {
    const rs = Array.from({ length: 120 }, (_, i) =>
      rec(`r${i}`, new Date(Date.UTC(2026, 10, 1, 0, i)).toISOString()),
    );
    const itens = montarConversa(rs, []);
    expect(itens).toHaveLength(100);
    expect(itens[0].id).toBe("r20");
    expect(itens[99].id).toBe("r119");
  });

  it("texto nulo de automática mostra o rótulo do tipo", () => {
    const [i] = montarConversa([], [env("e1", { texto: null, tipo: "lembrete", status: "pendente" })]);
    expect(i.texto).toBe("(mensagem automática: Lembrete)");
    expect(i.status).toBe("pendente");
  });
});

describe("montarConversa: falha e cancelamento", () => {
  it("leva o erro e o motivo do cancelamento para o item", () => {
    const itens = montarConversa(
      [],
      [
        { ...env("e1", { status: "falhou" }), erro: "Número inválido" },
        { ...env("e2", { status: "cancelada" }), cancelada_motivo: "Cancelada pela equipe" },
      ],
    );
    expect(itens[0]).toMatchObject({ erro: "Número inválido", canceladaMotivo: null });
    expect(itens[1]).toMatchObject({ erro: null, canceladaMotivo: "Cancelada pela equipe" });
  });

  it("mensagens futuras entram no histórico", () => {
    const itens = montarConversa(
      [rec("r1", "2026-11-10T12:00:00Z")],
      [env("e1", { status: "pendente", agendado_para: "2026-12-01T12:00:00Z" })],
    );
    expect(itens.map((i) => i.id)).toEqual(["r1", "e1"]);
  });
});

describe("carregarConversa", () => {
  it("lê recebidas e enviadas da cliente e monta a conversa", async () => {
    falso.responder("mensagens_recebidas", ok([rec("r1", "2026-11-10T12:00:00Z")]));
    falso.responder("fila_mensagens", ok([env("e1", { enviada_em: "2026-11-10T13:00:00Z" })]));
    const itens = await carregarConversa(falso.cliente as never, "c1");
    expect(itens.map((i) => i.id)).toEqual(["r1", "e1"]);
    expect(falso.chamadas.filter((c) => c.metodo === "eq")).toEqual([
      { tabela: "mensagens_recebidas", metodo: "eq", args: ["cliente_id", "c1"] },
      { tabela: "fila_mensagens", metodo: "eq", args: ["cliente_id", "c1"] },
    ]);
  });

  it("propaga erro do banco", async () => {
    falso.responder("mensagens_recebidas", { data: null, error: { message: "boom" } });
    falso.responder("fila_mensagens", ok([]));
    await expect(carregarConversa(falso.cliente as never, "c1")).rejects.toThrow();
  });
});
