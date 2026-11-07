import type { createClient } from "@/lib/supabase/server";

export type Supabase = Awaited<ReturnType<typeof createClient>>;

export type EntidadeAuditada =
  | "anamneses"
  | "termos_assinados"
  | "fotos"
  | "evolucoes"
  | "exportacao";

/** Registra a leitura na auditoria. Lança se falhar: sem registro, sem dado. */
export async function registrarAcesso(
  supabase: Supabase,
  a: {
    entidade: EntidadeAuditada;
    entidadeId?: string | null;
    clienteId: string;
  },
): Promise<void> {
  const { error } = await supabase.rpc("registrar_acesso", {
    p_entidade: a.entidade,
    p_entidade_id: a.entidadeId ?? null,
    p_cliente: a.clienteId,
  });
  if (error) throw new Error(error.message ?? "Falha ao registrar o acesso");
}
