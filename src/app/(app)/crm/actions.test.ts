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

import { enviarReativacao, enviarRetorno } from "./actions";

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
