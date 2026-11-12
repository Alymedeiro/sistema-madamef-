import { dataNoFuso, formatarNoFuso, horaNoFuso } from "@/lib/dominio/tempo";

/** Insere o emoji no cursor (ou no lugar da seleção); `cursor` é o novo índice UTF-16. */
export function inserirNoCursor(
  texto: string,
  inicio: number,
  fim: number,
  emoji: string,
): { texto: string; cursor: number } {
  const a = Math.min(Math.max(0, inicio), texto.length);
  const b = Math.min(Math.max(a, fim), texto.length);
  return { texto: texto.slice(0, a) + emoji + texto.slice(b), cursor: a + emoji.length };
}

/** "Hoje", "Ontem" ou dd/MM/aaaa, com o dia contado em São Paulo. */
export function rotuloDia(quando: Date | string, agora: Date = new Date()): string {
  const dia = dataNoFuso(quando);
  if (dia === dataNoFuso(agora)) return "Hoje";
  if (dia === dataNoFuso(new Date(agora.getTime() - 86_400_000))) return "Ontem";
  return formatarNoFuso(quando, "dd/MM/yyyy");
}

/** Só espaços/quebras de linha não são mensagem. */
export function textoEnviavel(texto: string): boolean {
  return texto.trim().length > 0;
}

type Retorno = { ok: true } | { ok: false; erro: string };
type Acoes = {
  enviar: (d: { clienteId: string; texto: string }) => Promise<Retorno>;
  marcarLida: (id: string) => Promise<Retorno>;
};

/**
 * Envia a resposta; se der certo e a resposta que abriu o painel ainda não foi
 * lida, marca como lida. Texto em branco não chama nada.
 */
export async function enviarResposta(
  d: { clienteId: string; texto: string; respostaId: string; jaLida: boolean },
  acoes: Acoes,
): Promise<{ ok: true; lida: boolean } | { ok: false; erro: string }> {
  if (!textoEnviavel(d.texto)) return { ok: false, erro: "Escreva a mensagem." };
  const r = await acoes.enviar({ clienteId: d.clienteId, texto: d.texto });
  if (!r.ok) return r;
  if (d.jaLida) return { ok: true, lida: true };
  const m = await acoes.marcarLida(d.respostaId);
  return { ok: true, lida: m.ok };
}

/** Rolar para o fim só se a usuária já estava a até 80 px dele. */
export function estaPertoDoFim(
  e: { scrollTop: number; scrollHeight: number; clientHeight: number },
  margem = 80,
): boolean {
  return e.scrollHeight - e.scrollTop - e.clientHeight <= margem;
}

/** Horário da lista de conversas: "HH:mm" se hoje, "Ontem", senão "dd/MM" (São Paulo). */
export function rotuloHorarioConversa(quando: Date | string, agora: Date = new Date()): string {
  const dia = rotuloDia(quando, agora);
  if (dia === "Hoje") return horaNoFuso(quando);
  if (dia === "Ontem") return dia;
  return formatarNoFuso(quando, "dd/MM");
}

/** Motivo gravado quando a equipe cancela pelo balão. */
export const MOTIVO_CANCELAMENTO_EQUIPE = "Cancelada pela equipe";

type AcoesBalao = {
  cancelar: (d: { id: string; motivo: string }) => Promise<Retorno>;
  reenviar: (id: string) => Promise<Retorno>;
};

/** "Cancelar" do balão de uma mensagem pendente. */
export function cancelarDoBalao(id: string, acoes: Pick<AcoesBalao, "cancelar">) {
  return acoes.cancelar({ id, motivo: MOTIVO_CANCELAMENTO_EQUIPE });
}

/** "Tentar de novo" do balão de uma mensagem com falha. */
export function reenviarDoBalao(id: string, acoes: Pick<AcoesBalao, "reenviar">) {
  return acoes.reenviar(id);
}

/** "Agendada para dd/MM HH:mm" quando a mensagem pendente ainda não chegou na hora; senão nulo. */
export function rotuloAgendada(
  m: { status?: string; quando: string },
  agora: Date = new Date(),
): string | null {
  if (m.status !== "pendente" || new Date(m.quando).getTime() <= agora.getTime()) return null;
  return `Agendada para ${formatarNoFuso(m.quando, "dd/MM HH:mm")}`;
}
