import { describe, expect, it } from "vitest";
import { criarSupabaseFalso } from "@/test/supabase-falso";
import { registrarAcesso, type Supabase } from "./acesso";

const C = "c1111111-1111-4111-8111-111111111111";

describe("registrarAcesso", () => {
  it("chama a RPC e lança se falhar", async () => {
    const falso = criarSupabaseFalso();
    const cliente = falso.cliente as unknown as Supabase;
    falso.responder("rpc:registrar_acesso", { data: null, error: null });
    await registrarAcesso(cliente, { entidade: "fotos", clienteId: C });
    expect(falso.chamadasRpc("registrar_acesso")[0].args[0]).toEqual({
      p_entidade: "fotos",
      p_entidade_id: null,
      p_cliente: C,
    });
    falso.responder("rpc:registrar_acesso", {
      data: null,
      error: { code: "P0001", message: "Acesso não autorizado" },
    });
    await expect(
      registrarAcesso(cliente, { entidade: "fotos", clienteId: C }),
    ).rejects.toThrow("Acesso não autorizado");
  });
});
