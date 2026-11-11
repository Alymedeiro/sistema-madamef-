import { gerarPdfRelatorio } from "@/lib/financeiro/pdf-relatorio";
import { exigirPerfil } from "@/lib/sessao";
import { createClient } from "@/lib/supabase/server";
import { conteudoDoRelatorio, parametrosDoRelatorio, rotuloDoPeriodo } from "../relatorio";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * PDF da aba e do período atuais do Financeiro. Só a dona: sem login vai ao
 * /login (exigirPerfil); logado com outro perfil, 403 — URL direta não baixa nada.
 * O relatório é registrado (registrar_relatorio) antes de qualquer leitura.
 */
export async function GET(req: Request) {
  const { colaborador } = await exigirPerfil();
  if (colaborador.perfil !== "dona") {
    return new Response("Acesso não autorizado", { status: 403 });
  }

  const agora = new Date();
  const p = parametrosDoRelatorio(new URL(req.url).searchParams, agora);
  const { de, ate } = p.periodo;
  const supabase = await createClient();

  const registro = await supabase.rpc("registrar_relatorio", { p_aba: p.aba, p_de: de, p_ate: ate });
  if (registro.error) throw new Error(`Falha ao registrar o relatório: ${registro.error.message}`);

  const conteudo = await conteudoDoRelatorio(supabase, p, agora);
  const pdf = await gerarPdfRelatorio({
    aba: p.aba,
    periodoRotulo: rotuloDoPeriodo(p.periodo),
    geradoPor: colaborador.nome,
    geradoEm: agora,
    ...conteudo,
  });

  return new Response(new Blob([pdf as BlobPart], { type: "application/pdf" }), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="financeiro-${p.aba}-${de}-${ate}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
