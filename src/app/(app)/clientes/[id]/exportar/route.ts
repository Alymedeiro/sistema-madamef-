import { exigirPerfil } from "@/lib/sessao";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { idSchema } from "@/lib/validacao";
import { gerarZipExportacao } from "../../ficha/exportacao";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Exportação dos dados da cliente (LGPD). Só a dona; audita e responde em streaming. */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  await exigirPerfil("dona");
  const { id } = await params;
  if (!idSchema.safeParse(id).success) return new Response("Não encontrada", { status: 404 });

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("clientes")
    .select("id, nome")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`Falha ao carregar a cliente: ${error.message}`);
  if (!data) return new Response("Não encontrada", { status: 404 });

  // Cliente de serviço só depois da checagem da dona; a auditoria falhando lança antes de baixar algo.
  const { nome, corpo } = await gerarZipExportacao(supabase, data.id, createAdminClient());
  return new Response(corpo, {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${nome}"`,
      "Cache-Control": "no-store",
    },
  });
}
