import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Perfil } from "@/lib/dominio/permissoes";
import type { Pergunta } from "@/lib/dominio/anamnese";
import { criarSupabaseFalso } from "@/test/supabase-falso";

let perfilAtual: Perfil = "dona";
const exigirPerfil = vi.fn(async (...perfis: Perfil[]) => {
  if (perfis.length > 0 && !perfis.includes(perfilAtual)) throw new Error("REDIRECT:/inicio");
  return { userId: "u1", colaborador: { id: "c1", nome: "Teste", perfil: perfilAtual } };
});
vi.mock("@/lib/sessao", () => ({ exigirPerfil: (...p: Perfil[]) => exigirPerfil(...p) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

let falso = criarSupabaseFalso();
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => falso.cliente }));

import { salvarModeloAnamnese } from "./actions";

const P: Pergunta[] = [
  { id: "a", tipo: "sim_nao", texto: "A?", obrigatoria: true, alerta: true },
];

beforeEach(() => {
  perfilAtual = "dona";
  falso = criarSupabaseFalso();
});

describe("salvarModeloAnamnese", () => {
  it("só a dona", async () => {
    perfilAtual = "recepcao";
    await expect(salvarModeloAnamnese({ titulo: "T", perguntas: P })).rejects.toThrow("REDIRECT:/inicio");
    expect(falso.chamadas).toHaveLength(0);
    expect(exigirPerfil).toHaveBeenCalledWith("dona");
  });

  it("sem mudança não chama a RPC", async () => {
    falso.responder("modelos_anamnese", { data: { titulo: "T", perguntas: P }, error: null });
    expect(await salvarModeloAnamnese({ titulo: "T", perguntas: P })).toEqual({ ok: true });
    expect(falso.chamadasRpc("salvar_modelo_anamnese")).toHaveLength(0);
  });

  it("com mudança chama a RPC", async () => {
    falso.responder("modelos_anamnese", { data: { titulo: "T", perguntas: P }, error: null });
    falso.responder("rpc:salvar_modelo_anamnese", { data: "novo", error: null });
    const novas = [...P, { id: "b", tipo: "texto" as const, texto: "B?", obrigatoria: false, alerta: false }];
    expect(await salvarModeloAnamnese({ titulo: "T", perguntas: novas })).toEqual({ ok: true });
    expect(falso.chamadasRpc("salvar_modelo_anamnese")[0].args[0]).toEqual({
      p_titulo: "T",
      p_perguntas: novas,
    });
  });

  it("valida as perguntas", async () => {
    expect(await salvarModeloAnamnese({ titulo: "T", perguntas: [] })).toEqual({
      ok: false,
      erro: "Adicione ao menos uma pergunta.",
    });
    expect(falso.chamadas).toHaveLength(0);
  });
});
