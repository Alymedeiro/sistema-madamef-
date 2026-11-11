import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Perfil } from "@/lib/dominio/permissoes";
import { criarSupabaseFalso } from "@/test/supabase-falso";

let perfilAtual: Perfil = "recepcao";
const exigirPerfil = vi.fn(async (...perfis: Perfil[]) => {
  if (perfis.length > 0 && !perfis.includes(perfilAtual)) throw new Error("REDIRECT:/inicio");
  return { userId: "u1", colaborador: { id: "c1", nome: "Teste", perfil: perfilAtual } };
});
vi.mock("@/lib/sessao", () => ({ exigirPerfil: (...p: Perfil[]) => exigirPerfil(...p) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

let falso = criarSupabaseFalso();
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => falso.cliente }));

import { cancelarMensagem, enviarWhatsApp, marcarRespostaLida, reenviarMensagem } from "./actions";

const CLIENTE = "00000000-0000-4000-8000-0000000000c1";
const AGENDAMENTO = "00000000-0000-4000-8000-0000000000a1";
const MSG = "00000000-0000-4000-8000-0000000000f1";
const p0001 = (message: string) => ({ data: null, error: { code: "P0001", message } });

beforeEach(() => {
  perfilAtual = "recepcao";
  falso = criarSupabaseFalso();
  falso.definirPadrao({ data: null, error: null });
});

describe("permissão", () => {
  it("profissional é negada em todas as ações, sem tocar no banco", async () => {
    perfilAtual = "profissional";
    await expect(enviarWhatsApp({ clienteId: CLIENTE, texto: "Oi" })).rejects.toThrow("REDIRECT");
    await expect(cancelarMensagem({ id: MSG })).rejects.toThrow("REDIRECT");
    await expect(reenviarMensagem(MSG)).rejects.toThrow("REDIRECT");
    await expect(marcarRespostaLida(MSG)).rejects.toThrow("REDIRECT");
    expect(falso.chamadas).toHaveLength(0);
    expect(exigirPerfil).toHaveBeenCalledWith("dona", "recepcao");
  });

  it("dona pode enviar", async () => {
    perfilAtual = "dona";
    expect(await enviarWhatsApp({ clienteId: CLIENTE, texto: "Oi" })).toEqual({ ok: true });
  });
});

describe("enviarWhatsApp", () => {
  it("texto vazio ou só espaços é recusado antes do banco", async () => {
    expect(await enviarWhatsApp({ clienteId: CLIENTE, texto: "" })).toEqual({
      ok: false,
      erro: "Escreva a mensagem.",
    });
    expect(await enviarWhatsApp({ clienteId: CLIENTE, texto: "   \n " })).toEqual({
      ok: false,
      erro: "Escreva a mensagem.",
    });
    expect((await enviarWhatsApp({ clienteId: CLIENTE, texto: "x".repeat(1001) })).ok).toBe(false);
    expect((await enviarWhatsApp({ clienteId: "x", texto: "Oi" })).ok).toBe(false);
    expect(falso.chamadas).toHaveLength(0);
  });

  it("chama enviar_avulsa com o texto aparado e o agendamento", async () => {
    expect(
      await enviarWhatsApp({ clienteId: CLIENTE, texto: "  Oi, Ana!  ", agendamentoId: AGENDAMENTO }),
    ).toEqual({ ok: true });
    expect(falso.chamadasRpc("enviar_avulsa")[0].args[0]).toEqual({
      p_cliente: CLIENTE,
      p_texto: "Oi, Ana!",
      p_agendamento: AGENDAMENTO,
    });
  });

  it("sem agendamento manda null", async () => {
    await enviarWhatsApp({ clienteId: CLIENTE, texto: "Oi" });
    expect(falso.chamadasRpc("enviar_avulsa")[0].args[0]).toMatchObject({ p_agendamento: null });
  });

  it("repassa as mensagens do banco", async () => {
    for (const m of [
      "Esta cliente não tem WhatsApp cadastrado.",
      "Apenas a dona ou a recepção podem enviar mensagens.",
      "Agendamento não encontrado.",
    ]) {
      falso.responder("rpc:enviar_avulsa", p0001(m));
      expect(await enviarWhatsApp({ clienteId: CLIENTE, texto: "Oi" })).toEqual({ ok: false, erro: m });
    }
  });

  it("erro técnico vira mensagem genérica", async () => {
    falso.responder("rpc:enviar_avulsa", { data: null, error: { code: "XX000", message: "boom" } });
    const r = await enviarWhatsApp({ clienteId: CLIENTE, texto: "Oi" });
    expect(r).toEqual({ ok: false, erro: "Não foi possível concluir. Tente novamente." });
  });
});

describe("cancelarMensagem", () => {
  it("chama cancelar_mensagem com o motivo aparado (vazio → '')", async () => {
    await cancelarMensagem({ id: MSG, motivo: "  cliente pediu  " });
    await cancelarMensagem({ id: MSG });
    expect(falso.chamadasRpc("cancelar_mensagem").map((c) => c.args[0])).toEqual([
      { p_id: MSG, p_motivo: "cliente pediu" },
      { p_id: MSG, p_motivo: "" },
    ]);
  });

  it("motivo acima de 200 é recusado antes do banco", async () => {
    expect((await cancelarMensagem({ id: MSG, motivo: "x".repeat(201) })).ok).toBe(false);
    expect(falso.chamadas).toHaveLength(0);
  });

  it("repassa as mensagens do banco", async () => {
    for (const m of [
      "Esta mensagem já foi enviada.",
      "Só é possível cancelar mensagens pendentes.",
      "Mensagem não encontrada.",
    ]) {
      falso.responder("rpc:cancelar_mensagem", p0001(m));
      expect(await cancelarMensagem({ id: MSG })).toEqual({ ok: false, erro: m });
    }
  });
});

describe("reenviarMensagem", () => {
  it("chama reenviar_mensagem e repassa as mensagens do banco", async () => {
    falso.responder("rpc:reenviar_mensagem", { data: MSG, error: null });
    expect(await reenviarMensagem(MSG)).toEqual({ ok: true });
    expect(falso.chamadasRpc("reenviar_mensagem")[0].args[0]).toEqual({ p_id: MSG });

    for (const m of [
      "Só é possível reenviar mensagens com falha ou canceladas.",
      "Já existe uma mensagem pendente deste tipo.",
    ]) {
      falso.responder("rpc:reenviar_mensagem", p0001(m));
      expect(await reenviarMensagem(MSG)).toEqual({ ok: false, erro: m });
    }
  });

  it("id inválido é recusado antes do banco", async () => {
    expect((await reenviarMensagem("abc")).ok).toBe(false);
    expect(falso.chamadas).toHaveLength(0);
  });
});

describe("marcarRespostaLida", () => {
  it("chama marcar_recebida_lida e repassa a mensagem do banco", async () => {
    expect(await marcarRespostaLida(MSG)).toEqual({ ok: true });
    expect(falso.chamadasRpc("marcar_recebida_lida")[0].args[0]).toEqual({ p_id: MSG });
    falso.responder("rpc:marcar_recebida_lida", p0001("Mensagem não encontrada."));
    expect(await marcarRespostaLida(MSG)).toEqual({ ok: false, erro: "Mensagem não encontrada." });
  });
});
