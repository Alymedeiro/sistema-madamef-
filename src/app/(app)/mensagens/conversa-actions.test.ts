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
vi.mock("server-only", () => ({}));

let falso = criarSupabaseFalso();
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => falso.cliente }));

import {
  buscarConversa,
  buscarConversaSemCadastro,
  listarConversas,
  marcarConversaLida,
} from "./actions";

const CLIENTE = "00000000-0000-4000-8000-0000000000c1";

beforeEach(() => {
  perfilAtual = "recepcao";
  falso = criarSupabaseFalso();
  falso.definirPadrao({ data: null, error: null });
});

describe("buscarConversa", () => {
  it("profissional é negada, sem tocar no banco", async () => {
    perfilAtual = "profissional";
    await expect(buscarConversa(CLIENTE)).rejects.toThrow("REDIRECT");
    expect(falso.chamadas).toHaveLength(0);
    expect(exigirPerfil).toHaveBeenCalledWith("dona", "recepcao");
  });

  it("uuid inválido é recusado antes do banco", async () => {
    expect((await buscarConversa("x")).ok).toBe(false);
    expect(falso.chamadas).toHaveLength(0);
  });

  it("devolve os itens da conversa", async () => {
    falso.responder("mensagens_recebidas", {
      data: [{ id: "r1", texto: "Oi", recebida_em: "2026-11-10T12:00:00Z" }],
      error: null,
    });
    falso.responder("fila_mensagens", { data: [], error: null });
    expect(await buscarConversa(CLIENTE)).toEqual({
      ok: true,
      itens: [{ id: "r1", direcao: "recebida", texto: "Oi", quando: "2026-11-10T12:00:00Z" }],
    });
  });

  it("URL assinada da mídia exige perfil: profissional não chega ao Storage", async () => {
    const linha = {
      id: "r1",
      texto: "",
      recebida_em: "2026-11-10T12:00:00Z",
      midia_tipo: "imagem",
      midia_status: "salva",
      midia_path: "2026/11/r1.jpg",
    };
    perfilAtual = "profissional";
    falso.responder("mensagens_recebidas", { data: [linha], error: null });
    await expect(buscarConversa(CLIENTE)).rejects.toThrow("REDIRECT");
    await expect(buscarConversaSemCadastro("5511987654321")).rejects.toThrow("REDIRECT");
    expect(falso.chamadasDe("storage:whatsapp-midia")).toHaveLength(0);

    perfilAtual = "recepcao";
    falso.responder("fila_mensagens", { data: [], error: null });
    const r = await buscarConversa(CLIENTE);
    expect(r.ok && r.itens[0].midia?.url).toBe("https://assinada/2026/11/r1.jpg");
    expect(falso.chamadasDe("storage:whatsapp-midia", "createSignedUrls")[0].args[1]).toBe(600);
  });

  it("erro do banco vira falha", async () => {
    falso.responder("mensagens_recebidas", { data: null, error: { message: "boom" } });
    falso.responder("fila_mensagens", { data: [], error: null });
    expect((await buscarConversa(CLIENTE)).ok).toBe(false);
  });
});

describe("marcarConversaLida", () => {
  const IDS = ["00000000-0000-4000-8000-0000000000a1", "00000000-0000-4000-8000-0000000000a2"];

  it("profissional é negada, sem tocar no banco", async () => {
    perfilAtual = "profissional";
    await expect(marcarConversaLida(IDS)).rejects.toThrow("REDIRECT");
    expect(falso.chamadas).toHaveLength(0);
  });

  it("ids inválidos ou demais são recusados antes do banco", async () => {
    expect((await marcarConversaLida(["x"])).ok).toBe(false);
    const muitos = Array.from(
      { length: 201 },
      (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
    );
    expect((await marcarConversaLida(muitos)).ok).toBe(false);
    expect(falso.chamadas).toHaveLength(0);
  });

  it("marca cada id como lido", async () => {
    expect(await marcarConversaLida(IDS)).toEqual({ ok: true });
    expect(falso.chamadasRpc("marcar_recebida_lida").map((c) => c.args[0])).toEqual([
      { p_id: IDS[0] },
      { p_id: IDS[1] },
    ]);
  });

  it("lista vazia não chama o banco", async () => {
    expect(await marcarConversaLida([])).toEqual({ ok: true });
    expect(falso.chamadas).toHaveLength(0);
  });
});

describe("buscarConversaSemCadastro", () => {
  it("profissional é negada e telefone inválido é recusado", async () => {
    perfilAtual = "profissional";
    await expect(buscarConversaSemCadastro("5511987654321")).rejects.toThrow("REDIRECT");
    perfilAtual = "recepcao";
    expect((await buscarConversaSemCadastro("abc")).ok).toBe(false);
    expect(falso.chamadas).toHaveLength(0);
  });
});

describe("listarConversas", () => {
  it("profissional é negada, sem tocar no banco", async () => {
    perfilAtual = "profissional";
    await expect(listarConversas({})).rejects.toThrow("REDIRECT");
    expect(falso.chamadas).toHaveLength(0);
  });

  it("lista conversas (inclusive só de enviadas) e ignora filtro inválido", async () => {
    falso.responder("mensagens_recebidas", { data: [], error: null });
    falso.responder("fila_mensagens", {
      data: [
        {
          id: "e1",
          telefone: "5511987654321",
          texto: "Oi",
          status: "enviada",
          tipo: "avulsa",
          enviada_em: "2026-11-10T13:00:00Z",
          agendado_para: "2026-11-10T13:00:00Z",
          cliente_id: "c1",
          clientes: { nome: "Ana" },
        },
      ],
      error: null,
    });
    const r = await listarConversas({ status: "nao-existe" as never });
    expect(r.ok && r.conversas.map((c) => c.chave)).toEqual(["c1"]);
  });
});
