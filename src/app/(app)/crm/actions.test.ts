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

import {
  converterLead,
  enviarReativacao,
  enviarRetorno,
  enviarWhatsAppLead,
  moverLead,
  salvarLead,
} from "./actions";

const AGENDAMENTO = "00000000-0000-4000-8000-0000000000a1";
const C1 = "00000000-0000-4000-8000-0000000000c1";
const C2 = "00000000-0000-4000-8000-0000000000c2";
const p0001 = (message: string) => ({ data: null, error: { code: "P0001", message } });

beforeEach(() => {
  perfilAtual = "recepcao";
  falso = criarSupabaseFalso();
  falso.definirPadrao({ data: null, error: null });
});

describe("permissão", () => {
  it("profissional é negada, sem tocar no banco", async () => {
    perfilAtual = "profissional";
    await expect(enviarRetorno(AGENDAMENTO)).rejects.toThrow("REDIRECT");
    await expect(enviarReativacao([C1])).rejects.toThrow("REDIRECT");
    expect(falso.chamadas).toHaveLength(0);
    expect(exigirPerfil).toHaveBeenCalledWith("dona", "recepcao");
  });
});

describe("enviarRetorno", () => {
  it("id inválido é recusado antes do banco", async () => {
    expect((await enviarRetorno("x")).ok).toBe(false);
    expect(falso.chamadas).toHaveLength(0);
  });

  it("chama enviar_retorno e devolve ok", async () => {
    falso.responder("rpc:enviar_retorno", { data: "msg-1", error: null });
    expect(await enviarRetorno(AGENDAMENTO)).toEqual({ ok: true });
    expect(falso.chamadasRpc("enviar_retorno")[0].args[0]).toEqual({ p_agendamento: AGENDAMENTO });
  });

  it("repassa as mensagens do banco", async () => {
    for (const m of [
      "A cliente não aceitou mensagens de marketing.",
      "Já existe um retorno na fila para este atendimento.",
      "Esta cliente não tem WhatsApp cadastrado.",
      "Este atendimento não tem retorno.",
    ]) {
      falso.responder("rpc:enviar_retorno", p0001(m));
      expect(await enviarRetorno(AGENDAMENTO)).toEqual({ ok: false, erro: m });
    }
  });
});

describe("enviarReativacao", () => {
  it("lista vazia é recusada antes do banco", async () => {
    expect(await enviarReativacao([])).toEqual({ ok: false, erro: "Escolha pelo menos uma cliente." });
    expect(falso.chamadas).toHaveLength(0);
  });

  it("mais de 500 e ids inválidos são recusados antes do banco", async () => {
    const muitos = Array.from(
      { length: 501 },
      (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
    );
    expect(await enviarReativacao(muitos)).toEqual({
      ok: false,
      erro: "Escolha no máximo 500 clientes.",
    });
    expect((await enviarReativacao(["x"])).ok).toBe(false);
    expect(falso.chamadas).toHaveLength(0);
  });

  it("repassa o erro P0001 do banco", async () => {
    falso.responder("rpc:enviar_reativacao", p0001("Apenas a dona ou a recepção podem usar o CRM."));
    expect(await enviarReativacao([C1])).toEqual({
      ok: false,
      erro: "Apenas a dona ou a recepção podem usar o CRM.",
    });
  });

  it("sucesso devolve as contagens e tira ids repetidos", async () => {
    falso.responder("rpc:enviar_reativacao", {
      data: [{ enfileiradas: 1, puladas: 1 }],
      error: null,
    });
    expect(await enviarReativacao([C1, C2, C1])).toEqual({ ok: true, enfileiradas: 1, puladas: 1 });
    expect(falso.chamadasRpc("enviar_reativacao")[0].args[0]).toEqual({ p_clientes: [C1, C2] });
  });

  it("resposta sem linha vira erro genérico", async () => {
    falso.responder("rpc:enviar_reativacao", { data: [], error: null });
    expect((await enviarReativacao([C1])).ok).toBe(false);
  });
});

const LEAD = "00000000-0000-4000-8000-0000000000d1";

const achou = { data: [{ id: LEAD }], error: null };

describe("leads: permissão", () => {
  it("profissional é negada, sem tocar no banco", async () => {
    perfilAtual = "profissional";
    await expect(salvarLead({ nome: "Ana" })).rejects.toThrow("REDIRECT");
    await expect(moverLead({ id: LEAD, etapa: "novo" })).rejects.toThrow("REDIRECT");
    await expect(converterLead({ id: LEAD, aceiteLgpd: true, aceitaMarketing: false })).rejects.toThrow("REDIRECT");
    await expect(enviarWhatsAppLead({ id: LEAD, texto: "oi" })).rejects.toThrow("REDIRECT");
    expect(falso.chamadas).toHaveLength(0);
  });
});

describe("salvarLead", () => {
  it("nome vazio e WhatsApp inválido são recusados antes do banco", async () => {
    expect(await salvarLead({ nome: "" })).toEqual({ ok: false, erro: "Informe o nome do lead." });
    expect(await salvarLead({ nome: "Ana", whatsapp: "12" })).toEqual({
      ok: false,
      erro: "Informe um WhatsApp válido.",
    });
    expect(falso.chamadas).toHaveLength(0);
  });

  it("cria com o WhatsApp normalizado", async () => {
    expect(await salvarLead({ nome: "Ana", whatsapp: "(41) 99999-0000" })).toEqual({ ok: true });
    expect(falso.chamadasDe("leads", "insert")[0].args[0]).toMatchObject({
      nome: "Ana",
      whatsapp: "5541999990000",
    });
  });

  it("com id atualiza só as colunas do formulário", async () => {
    falso.responder("leads", achou);
    expect(await salvarLead({ id: LEAD, nome: "Ana" })).toEqual({ ok: true });
    const upd = falso.chamadasDe("leads", "update")[0].args[0] as Record<string, unknown>;
    expect(upd).not.toHaveProperty("cliente_id");
    expect(upd).not.toHaveProperty("etapa");
    expect(falso.chamadasDe("leads", "eq")[0].args).toEqual(["id", LEAD]);
  });

  it("lead inexistente e erros do banco", async () => {
    falso.responder("leads", { data: [], error: null });
    expect(await salvarLead({ id: LEAD, nome: "Ana" })).toEqual({ ok: false, erro: "Lead não encontrado." });
    falso.responder("leads", p0001("Para ligar o lead a uma cliente, use Converter em cliente."));
    expect(await salvarLead({ id: LEAD, nome: "Ana" })).toEqual({
      ok: false,
      erro: "Para ligar o lead a uma cliente, use Converter em cliente.",
    });
  });
});

describe("moverLead", () => {
  it("motivo só vai com perdido", async () => {
    falso.responder("leads", achou, achou);
    expect((await moverLead({ id: LEAD, etapa: "agendou", motivo: "qualquer" })).ok).toBe(true);
    expect(falso.chamadasDe("leads", "update")[0].args[0]).toEqual({ etapa: "agendou" });
    expect((await moverLead({ id: LEAD, etapa: "perdido", motivo: " caro " })).ok).toBe(true);
    expect(falso.chamadasDe("leads", "update")[1].args[0]).toEqual({ etapa: "perdido", perdido_motivo: "caro" });
  });

  it("motivo > 200 é recusado antes do banco", async () => {
    expect((await moverLead({ id: LEAD, etapa: "perdido", motivo: "m".repeat(201) })).ok).toBe(false);
    expect(falso.chamadas).toHaveLength(0);
  });
});

describe("converterLead", () => {
  it("sem aceite: recusa antes do banco", async () => {
    expect(await converterLead({ id: LEAD, aceiteLgpd: false, aceitaMarketing: true })).toEqual({
      ok: false,
      erro: "Confirme o aceite da LGPD.",
    });
    expect(falso.chamadas).toHaveLength(0);
  });

  it("devolve o id da cliente", async () => {
    const CLIENTE = "00000000-0000-4000-8000-0000000000c9";
    falso.responder("rpc:converter_lead", { data: CLIENTE, error: null });
    expect(await converterLead({ id: LEAD, aceiteLgpd: true, aceitaMarketing: false })).toEqual({
      ok: true,
      clienteId: CLIENTE,
    });
    expect(falso.chamadasRpc("converter_lead")[0].args[0]).toEqual({
      p_lead: LEAD,
      p_aceite_lgpd: true,
      p_aceita_marketing: false,
    });
  });

  it("repassa 'Este lead já virou cliente.'", async () => {
    falso.responder("rpc:converter_lead", p0001("Este lead já virou cliente."));
    expect(await converterLead({ id: LEAD, aceiteLgpd: true, aceitaMarketing: true })).toEqual({
      ok: false,
      erro: "Este lead já virou cliente.",
    });
  });
});

describe("enviarWhatsAppLead", () => {
  it("texto vazio é recusado; sucesso chama a RPC", async () => {
    expect(await enviarWhatsAppLead({ id: LEAD, texto: "  " })).toEqual({ ok: false, erro: "Escreva a mensagem." });
    expect(falso.chamadas).toHaveLength(0);
    falso.responder("rpc:enviar_avulsa_lead", { data: "m1", error: null });
    expect(await enviarWhatsAppLead({ id: LEAD, texto: " oi " })).toEqual({ ok: true });
    expect(falso.chamadasRpc("enviar_avulsa_lead")[0].args[0]).toEqual({ p_lead: LEAD, p_texto: "oi" });
  });

  it("repassa 'Este lead não tem WhatsApp cadastrado.'", async () => {
    falso.responder("rpc:enviar_avulsa_lead", p0001("Este lead não tem WhatsApp cadastrado."));
    expect((await enviarWhatsAppLead({ id: LEAD, texto: "oi" })).ok).toBe(false);
  });
});
