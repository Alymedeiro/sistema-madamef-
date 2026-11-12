import { dadosDaMensagem, podeEnviar, renderizarMensagem } from "@/lib/dominio/whatsapp";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/tipos";
import { tokenConfere } from "@/lib/whatsapp/token";
import { enviarTexto, statusConexao, temChavesWhatsapp } from "@/lib/whatsapp/zapi";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

type Admin = ReturnType<typeof createAdminClient>;
type Estado = Database["public"]["Tables"]["whatsapp_status"]["Row"]["estado"];

/** No máximo uma consulta ao status da Z-API a cada 5 min. */
const INTERVALO_STATUS_MS = 5 * 60_000;

const json = (corpo: Record<string, unknown>, status = 200) => Response.json(corpo, { status });

async function gravarStatus(admin: Admin, estado: Estado) {
  const { error } = await admin.rpc("gravar_status_whatsapp", { p_estado: estado });
  if (error) console.error("whatsapp: falha ao gravar status", error.message);
}

/**
 * Atualiza whatsapp_status e devolve o estado vigente. Sem chaves: grava
 * `sem_chaves` (só se mudou ou venceu). Com chaves: consulta a Z-API se o
 * último registro tem 5 min ou mais, nunca existiu, ou ainda diz `sem_chaves`
 * (chaves recém-coladas); senão vale o estado gravado.
 */
async function atualizarStatus(admin: Admin, temChaves: boolean, agora: Date): Promise<Estado> {
  const { data, error } = await admin
    .from("whatsapp_status")
    .select("estado, verificado_em")
    .maybeSingle();
  if (error) console.error("whatsapp: falha ao ler status", error.message);
  const verificado = data?.verificado_em ? new Date(data.verificado_em).getTime() : null;
  const vencido = verificado === null || agora.getTime() - verificado >= INTERVALO_STATUS_MS;
  const eraSemChaves = data?.estado === "sem_chaves";

  if (!temChaves) {
    if (vencido || !eraSemChaves) await gravarStatus(admin, "sem_chaves");
    return "sem_chaves";
  }
  if (vencido || eraSemChaves || !data) {
    const estado = await statusConexao();
    await gravarStatus(admin, estado);
    return estado;
  }
  return data.estado;
}

/**
 * Relógio do WhatsApp: chamado pelo pg_cron (pg_net) a cada minuto com o
 * token de whatsapp_relogio em `x-cron-token`. Envia no máximo 1 mensagem.
 * Desconectado (estado gravado há < 5 min ou recém-consultado) → não envia.
 * Autenticado, responde sempre 200 (o relógio não trata a resposta).
 */
export async function POST(req: Request) {
  const admin = createAdminClient();

  const relogio = await admin.from("whatsapp_relogio").select("token").maybeSingle();
  if (relogio.error || !tokenConfere(req.headers.get("x-cron-token"), relogio.data?.token)) {
    return json({ erro: "Não autorizado" }, 401);
  }

  const agora = new Date();
  const estado = await atualizarStatus(admin, temChavesWhatsapp(), agora);
  // Sem chaves ou desconectado: não pega mensagem; a fila acumula até voltar.
  if (estado !== "conectado") return json({ enviado: false, motivo: estado });

  const proxima = await admin.rpc("proxima_mensagem");
  if (proxima.error) {
    console.error("whatsapp: falha em proxima_mensagem", proxima.error.message);
    return json({ enviado: false, motivo: "erro" });
  }
  const linha = proxima.data?.[0];
  if (!linha) return json({ enviado: false, motivo: "fila_vazia" });

  const texto =
    linha.tipo === "avulsa"
      ? (linha.texto ?? "").trim()
      : renderizarMensagem(linha.variacoes ?? [], dadosDaMensagem(linha));

  const condicao = podeEnviar(
    linha.tipo,
    linha.status_agendamento,
    linha.inicio ? new Date(linha.inicio) : null,
    agora,
  );
  const motivoDescarte = !condicao.ok ? condicao.motivo : !texto ? "Mensagem sem texto" : null;
  if (motivoDescarte) {
    const { error } = await admin.rpc("descartar_envio", { p_id: linha.id, p_motivo: motivoDescarte });
    if (error) console.error("whatsapp: falha em descartar_envio", error.message);
    return json({ enviado: false, motivo: motivoDescarte });
  }

  const envio = await enviarTexto(linha.telefone, texto);
  if (envio.ok) {
    const { error } = await admin.rpc("concluir_envio", {
      p_id: linha.id,
      p_texto: texto,
      p_id_externo: envio.idExterno,
    });
    // A mensagem saiu; se o registro falhar, proxima_mensagem a marca como
    // 'falhou' depois de 10 min (sem reenviar sozinha, para não duplicar).
    if (error) console.error("whatsapp: falha em concluir_envio", error.message);
    return json({ enviado: true });
  }

  const { error } = await admin.rpc("falhar_envio", { p_id: linha.id, p_erro: envio.erro });
  if (error) console.error("whatsapp: falha em falhar_envio", error.message);
  if (envio.desconectado) await gravarStatus(admin, "desconectado");
  return json({ enviado: false, motivo: "falha", erro: envio.erro });
}
