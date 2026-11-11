vi.mock("server-only", () => ({}));
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { criarSupabaseFalso, type Resposta } from "@/test/supabase-falso";

let falso = criarSupabaseFalso();
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => falso.cliente }));

const zapi = vi.hoisted(() => ({
  credenciaisZapi: vi.fn(),
  enviarTexto: vi.fn(),
  statusConexao: vi.fn(),
}));
vi.mock("@/lib/whatsapp/zapi", () => zapi);

import { POST } from "./route";

const AGORA = new Date("2026-11-11T13:00:00.000Z"); // 10:00 em SP
const TOKEN = "a".repeat(64);
const MSG = "c0000000-0000-4000-8000-0000000000c1";
const ok = (data: unknown): Resposta => ({ data, error: null });

function requisicao(token?: string) {
  const headers = new Headers();
  if (token !== undefined) headers.set("x-cron-token", token);
  return new Request("http://localhost/api/whatsapp/processar", { method: "POST", headers });
}

function minutosAtras(min: number) {
  return new Date(AGORA.getTime() - min * 60_000).toISOString();
}

/** Token do relógio e status recente (não consulta a Z-API de novo). */
function prepararBase(status: { estado: string; verificado_em: string | null } = {
  estado: "conectado",
  verificado_em: minutosAtras(1),
}) {
  falso.responder("whatsapp_relogio", ok({ token: TOKEN }));
  falso.responder("whatsapp_status", ok(status));
}

const linhaConfirmacao = {
  id: MSG,
  tipo: "confirmacao",
  telefone: "5511988887777",
  texto: null,
  variacoes: ["Oi, {nome}! {servico} com {profissional} em {data} às {hora}. {clinica}"],
  nome: "Maria Souza",
  servico: "Limpeza de pele",
  profissional: "Ana",
  inicio: "2026-11-12T13:00:00+00:00", // 12/11 10:00 em SP
  status_agendamento: "pendente",
  clinica: "Madame Fé",
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(AGORA);
  falso = criarSupabaseFalso();
  falso.definirPadrao(ok(null));
  zapi.credenciaisZapi.mockReset().mockReturnValue({ instancia: "I", token: "T", clientToken: "C" });
  zapi.enviarTexto.mockReset().mockResolvedValue({ ok: true, idExterno: "m1" });
  zapi.statusConexao.mockReset().mockResolvedValue("conectado");
});
afterEach(() => {
  vi.useRealTimers();
});

describe("POST /api/whatsapp/processar — autenticação", () => {
  it("401 sem x-cron-token, sem chamar a fila", async () => {
    prepararBase();
    const r = await POST(requisicao());
    expect(r.status).toBe(401);
    expect(falso.chamadasRpc("proxima_mensagem")).toHaveLength(0);
    expect(zapi.enviarTexto).not.toHaveBeenCalled();
  });

  it("401 com token errado (inclusive de outro tamanho)", async () => {
    for (const errado of ["b".repeat(64), "curto", ""]) {
      falso = criarSupabaseFalso();
      prepararBase();
      const r = await POST(requisicao(errado));
      expect(r.status).toBe(401);
      expect(falso.chamadasRpc("proxima_mensagem")).toHaveLength(0);
    }
  });

  it("401 quando o token do banco não pode ser lido", async () => {
    falso.responder("whatsapp_relogio", { data: null, error: { message: "boom" } });
    const r = await POST(requisicao(TOKEN));
    expect(r.status).toBe(401);
    expect(falso.chamadasRpc("proxima_mensagem")).toHaveLength(0);
  });
});

describe("POST /api/whatsapp/processar — status da conexão", () => {
  it("sem chaves: grava sem_chaves e sai sem chamar proxima_mensagem", async () => {
    zapi.credenciaisZapi.mockReturnValue(null);
    prepararBase({ estado: "conectado", verificado_em: minutosAtras(1) });
    const r = await POST(requisicao(TOKEN));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ enviado: false, motivo: "sem_chaves" });
    expect(falso.chamadasRpc("gravar_status_whatsapp").map((c) => c.args[0])).toEqual([
      { p_estado: "sem_chaves" },
    ]);
    expect(zapi.statusConexao).not.toHaveBeenCalled();
    expect(falso.chamadasRpc("proxima_mensagem")).toHaveLength(0);
  });

  it("sem chaves já gravado há pouco: não regrava", async () => {
    zapi.credenciaisZapi.mockReturnValue(null);
    prepararBase({ estado: "sem_chaves", verificado_em: minutosAtras(1) });
    await POST(requisicao(TOKEN));
    expect(falso.chamadasRpc("gravar_status_whatsapp")).toHaveLength(0);
  });

  it("não consulta a Z-API de novo antes de 5 min", async () => {
    prepararBase({ estado: "conectado", verificado_em: minutosAtras(4) });
    falso.responder("rpc:proxima_mensagem", ok([]));
    await POST(requisicao(TOKEN));
    expect(zapi.statusConexao).not.toHaveBeenCalled();
    expect(falso.chamadasRpc("gravar_status_whatsapp")).toHaveLength(0);
  });

  it("após 5 min (ou nunca verificado) consulta e grava o estado", async () => {
    for (const verificado_em of [minutosAtras(5), null]) {
      falso = criarSupabaseFalso();
      zapi.statusConexao.mockReset().mockResolvedValue("desconectado");
      prepararBase({ estado: "conectado", verificado_em });
      falso.responder("rpc:proxima_mensagem", ok([]));
      await POST(requisicao(TOKEN));
      expect(zapi.statusConexao).toHaveBeenCalledTimes(1);
      expect(falso.chamadasRpc("gravar_status_whatsapp").map((c) => c.args[0])).toEqual([
        { p_estado: "desconectado" },
      ]);
    }
  });

  it("chaves recém-coladas (estado sem_chaves) consulta na hora", async () => {
    prepararBase({ estado: "sem_chaves", verificado_em: minutosAtras(1) });
    falso.responder("rpc:proxima_mensagem", ok([]));
    await POST(requisicao(TOKEN));
    expect(zapi.statusConexao).toHaveBeenCalledTimes(1);
    expect(falso.chamadasRpc("gravar_status_whatsapp").map((c) => c.args[0])).toEqual([
      { p_estado: "conectado" },
    ]);
  });
});

describe("POST /api/whatsapp/processar — envio", () => {
  it("fila vazia → 200 sem enviar", async () => {
    prepararBase();
    falso.responder("rpc:proxima_mensagem", ok([]));
    const r = await POST(requisicao(TOKEN));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ enviado: false, motivo: "fila_vazia" });
    expect(zapi.enviarTexto).not.toHaveBeenCalled();
  });

  it("envia o texto renderizado e conclui com o id externo", async () => {
    prepararBase();
    falso.responder("rpc:proxima_mensagem", ok([linhaConfirmacao]));
    const r = await POST(requisicao(TOKEN));
    const texto = "Oi, Maria! Limpeza de pele com Ana em 12/11 às 10:00. Madame Fé";
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ enviado: true });
    expect(zapi.enviarTexto).toHaveBeenCalledWith("5511988887777", texto);
    expect(falso.chamadasRpc("concluir_envio").map((c) => c.args[0])).toEqual([
      { p_id: MSG, p_texto: texto, p_id_externo: "m1" },
    ]);
    expect(falso.chamadasRpc("falhar_envio")).toHaveLength(0);
  });

  it("avulsa usa o texto já gravado", async () => {
    prepararBase();
    falso.responder(
      "rpc:proxima_mensagem",
      ok([
        {
          ...linhaConfirmacao,
          tipo: "avulsa",
          texto: "Mensagem pronta {nome}",
          variacoes: null,
          status_agendamento: null,
          inicio: null,
        },
      ]),
    );
    await POST(requisicao(TOKEN));
    expect(zapi.enviarTexto).toHaveBeenCalledWith("5511988887777", "Mensagem pronta {nome}");
    expect(falso.chamadasRpc("concluir_envio")[0].args[0]).toEqual({
      p_id: MSG,
      p_texto: "Mensagem pronta {nome}",
      p_id_externo: "m1",
    });
  });

  it("confirmação de agendamento já confirmado → descartar_envio, sem enviar", async () => {
    prepararBase();
    falso.responder(
      "rpc:proxima_mensagem",
      ok([{ ...linhaConfirmacao, status_agendamento: "confirmado" }]),
    );
    const r = await POST(requisicao(TOKEN));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({
      enviado: false,
      motivo: "Agendamento não está mais pendente",
    });
    expect(zapi.enviarTexto).not.toHaveBeenCalled();
    expect(falso.chamadasRpc("descartar_envio").map((c) => c.args[0])).toEqual([
      { p_id: MSG, p_motivo: "Agendamento não está mais pendente" },
    ]);
  });

  it("confirmação de horário que já passou → descartar_envio", async () => {
    prepararBase();
    falso.responder(
      "rpc:proxima_mensagem",
      ok([{ ...linhaConfirmacao, inicio: "2026-11-10T13:00:00+00:00" }]),
    );
    await POST(requisicao(TOKEN));
    expect(zapi.enviarTexto).not.toHaveBeenCalled();
    expect(falso.chamadasRpc("descartar_envio")[0].args[0]).toEqual({
      p_id: MSG,
      p_motivo: "Horário já passou",
    });
  });

  it("modelo sem variações (texto vazio) → descartar_envio", async () => {
    prepararBase();
    falso.responder("rpc:proxima_mensagem", ok([{ ...linhaConfirmacao, variacoes: [] }]));
    await POST(requisicao(TOKEN));
    expect(zapi.enviarTexto).not.toHaveBeenCalled();
    expect(falso.chamadasRpc("descartar_envio")[0].args[0]).toEqual({
      p_id: MSG,
      p_motivo: "Mensagem sem texto",
    });
  });

  it("falha no envio → falhar_envio com o erro", async () => {
    prepararBase();
    falso.responder("rpc:proxima_mensagem", ok([linhaConfirmacao]));
    zapi.enviarTexto.mockResolvedValue({ ok: false, erro: "Tempo esgotado", desconectado: false });
    const r = await POST(requisicao(TOKEN));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ enviado: false, motivo: "falha", erro: "Tempo esgotado" });
    expect(falso.chamadasRpc("falhar_envio").map((c) => c.args[0])).toEqual([
      { p_id: MSG, p_erro: "Tempo esgotado" },
    ]);
    expect(falso.chamadasRpc("concluir_envio")).toHaveLength(0);
    expect(falso.chamadasRpc("gravar_status_whatsapp")).toHaveLength(0);
  });

  it("falha por desconexão também grava o status desconectado", async () => {
    prepararBase();
    falso.responder("rpc:proxima_mensagem", ok([linhaConfirmacao]));
    zapi.enviarTexto.mockResolvedValue({
      ok: false,
      erro: "Z-API 400: disconnected",
      desconectado: true,
    });
    await POST(requisicao(TOKEN));
    expect(falso.chamadasRpc("falhar_envio")).toHaveLength(1);
    expect(falso.chamadasRpc("gravar_status_whatsapp").map((c) => c.args[0])).toEqual([
      { p_estado: "desconectado" },
    ]);
  });

  it("erro do banco em proxima_mensagem → 200 com motivo erro, sem enviar", async () => {
    const erro = vi.spyOn(console, "error").mockImplementation(() => {});
    prepararBase();
    falso.responder("rpc:proxima_mensagem", { data: null, error: { message: "boom" } });
    const r = await POST(requisicao(TOKEN));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ enviado: false, motivo: "erro" });
    expect(zapi.enviarTexto).not.toHaveBeenCalled();
    erro.mockRestore();
  });
});
