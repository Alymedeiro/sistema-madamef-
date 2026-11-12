import "server-only";
import { classificarTermoBusca, escaparLike } from "@/lib/dominio/clientes";
import type { ClassificacaoResposta, StatusMensagem, TipoMensagem } from "@/lib/dominio/whatsapp";
import type { createClient } from "@/lib/supabase/server";

type Supabase = Awaited<ReturnType<typeof createClient>>;

export const LIMITE_FILA = 200;
export const LIMITE_RESPOSTAS = 200;
/** Respostas não lidas no cartão do Início. */
export const LIMITE_RESPOSTAS_INICIO = 10;
/** O cartão "Mensagens com falha" conta as falhas desta janela. */
export const DIAS_FALHAS = 7;

export type ItemFila = {
  id: string;
  tipo: TipoMensagem;
  status: StatusMensagem;
  telefone: string;
  /** Nulo até o envio (o texto é montado na hora), exceto na avulsa. */
  texto: string | null;
  agendadoPara: string;
  enviadaEm: string | null;
  criadoEm: string;
  tentativas: number;
  erro: string | null;
  canceladaMotivo: string | null;
  clienteId: string | null;
  clienteNome: string | null;
  agendamentoId: string | null;
  /** Avulsa para lead: sem cliente, com o nome do lead. */
  leadId: string | null;
  leadNome: string | null;
};

export type Resposta = {
  id: string;
  telefone: string;
  texto: string;
  recebidaEm: string;
  classificacao: ClassificacaoResposta;
  lidaEm: string | null;
  clienteId: string | null;
  clienteNome: string | null;
  agendamentoId: string | null;
  /** Início do agendamento ligado à resposta (para o link da agenda). */
  agendamentoInicio: string | null;
};

export type FiltroFila = { status?: StatusMensagem; tipo?: TipoMensagem; busca?: string };

export type AlertasWhatsapp = {
  /** Envio ligado e estado ≠ conectado (inclui sem chaves). */
  desconectado: boolean;
  /** Envio ligado e as chaves da Z-API não estão no servidor. */
  semChaves: boolean;
  falhas: number;
  respostas: Resposta[];
};

function falhou(onde: string, error: { message: string } | null) {
  if (error) throw new Error(`Falha ao carregar ${onde}: ${error.message}`);
}

const SELECT_FILA =
  "id, tipo, status, telefone, texto, agendado_para, enviada_em, criado_em, tentativas, erro, cancelada_motivo, cliente_id, agendamento_id, lead_id, clientes(nome), leads(nome)";

type LinhaFila = {
  id: string;
  tipo: TipoMensagem;
  status: StatusMensagem;
  telefone: string;
  texto: string | null;
  agendado_para: string;
  enviada_em: string | null;
  criado_em: string;
  tentativas: number;
  erro: string | null;
  cancelada_motivo: string | null;
  cliente_id: string | null;
  agendamento_id: string | null;
  lead_id: string | null;
  clientes: { nome: string } | null;
  leads: { nome: string } | null;
};

/**
 * As 200 mensagens mais recentes da fila, com filtros por status, tipo e
 * cliente (nome sem acento ou pedaço do telefone).
 */
export async function carregarFila(supabase: Supabase, filtro: FiltroFila = {}): Promise<ItemFila[]> {
  const termo = classificarTermoBusca(filtro.busca ?? "");
  let clientesIds: string[] | null = null;
  if (termo.tipo === "nome") {
    const { data, error } = await supabase
      .from("clientes")
      .select("id")
      .ilike("nome_busca", `%${escaparLike(termo.texto)}%`)
      .limit(LIMITE_FILA);
    falhou("as clientes da busca", error);
    clientesIds = (data ?? []).map((c) => c.id);
    if (clientesIds.length === 0) return [];
  }

  let consulta = supabase.from("fila_mensagens").select(SELECT_FILA);
  if (filtro.status) consulta = consulta.eq("status", filtro.status);
  if (filtro.tipo) consulta = consulta.eq("tipo", filtro.tipo);
  if (clientesIds) consulta = consulta.in("cliente_id", clientesIds);
  if (termo.tipo === "numero") {
    // Só dígitos: o filtro `or` não precisa de escape.
    consulta = consulta.or(termo.digitos.map((d) => `telefone.like.*${d}*`).join(","));
  }

  const { data, error } = await consulta.order("criado_em", { ascending: false }).limit(LIMITE_FILA);
  falhou("a fila de mensagens", error);
  return ((data ?? []) as unknown as LinhaFila[]).map((l) => ({
    id: l.id,
    tipo: l.tipo,
    status: l.status,
    telefone: l.telefone,
    texto: l.texto,
    agendadoPara: l.agendado_para,
    enviadaEm: l.enviada_em,
    criadoEm: l.criado_em,
    tentativas: l.tentativas,
    erro: l.erro,
    canceladaMotivo: l.cancelada_motivo,
    clienteId: l.cliente_id,
    clienteNome: l.clientes?.nome ?? null,
    agendamentoId: l.agendamento_id,
    leadId: l.lead_id,
    leadNome: l.leads?.nome ?? null,
  }));
}

const SELECT_RESPOSTA =
  "id, telefone, texto, recebida_em, classificacao, lida_em, cliente_id, agendamento_id, clientes(nome), agendamentos(inicio)";

type LinhaResposta = {
  id: string;
  telefone: string;
  texto: string;
  recebida_em: string;
  classificacao: ClassificacaoResposta;
  lida_em: string | null;
  cliente_id: string | null;
  agendamento_id: string | null;
  clientes: { nome: string } | null;
  agendamentos: { inicio: string } | null;
};

function paraResposta(l: LinhaResposta): Resposta {
  return {
    id: l.id,
    telefone: l.telefone,
    texto: l.texto,
    recebidaEm: l.recebida_em,
    classificacao: l.classificacao,
    lidaEm: l.lida_em,
    clienteId: l.cliente_id,
    clienteNome: l.clientes?.nome ?? null,
    agendamentoId: l.agendamento_id,
    agendamentoInicio: l.agendamentos?.inicio ?? null,
  };
}

/** Respostas recebidas, mais recentes primeiro (lidas e não lidas). */
export async function carregarRespostas(
  supabase: Supabase,
  filtro: { classificacao?: ClassificacaoResposta } = {},
): Promise<Resposta[]> {
  let consulta = supabase.from("mensagens_recebidas").select(SELECT_RESPOSTA);
  if (filtro.classificacao) consulta = consulta.eq("classificacao", filtro.classificacao);
  const { data, error } = await consulta
    .order("recebida_em", { ascending: false })
    .limit(LIMITE_RESPOSTAS);
  falhou("as respostas do WhatsApp", error);
  return ((data ?? []) as unknown as LinhaResposta[]).map(paraResposta);
}

const SELECT_CHAVE = "status, tipo, cliente_id, agendamento_id, pedido_online_id, criado_em";

export type LinhaChave = {
  status: StatusMensagem;
  tipo: TipoMensagem;
  cliente_id: string | null;
  agendamento_id: string | null;
  pedido_online_id: string | null;
  criado_em: string;
};

/**
 * Falhas que ainda pedem atenção: "Tentar de novo" cria uma mensagem nova e a
 * antiga fica `falhou`; ela deixa de contar quando há uma mais nova, não
 * cancelada nem com falha, do mesmo tipo, cliente e agendamento/pedido.
 */
export function contarFalhasSemReenvio(linhas: LinhaChave[]): number {
  const chave = (l: LinhaChave) =>
    [l.tipo, l.cliente_id ?? "", l.agendamento_id ?? "", l.pedido_online_id ?? ""].join("|");
  const ultimaViva = new Map<string, number>();
  for (const l of linhas) {
    if (l.status === "falhou") continue;
    const t = new Date(l.criado_em).getTime();
    const k = chave(l);
    ultimaViva.set(k, Math.max(ultimaViva.get(k) ?? -Infinity, t));
  }
  return linhas.filter(
    (l) => l.status === "falhou" && !((ultimaViva.get(chave(l)) ?? -Infinity) > new Date(l.criado_em).getTime()),
  ).length;
}

/** Falhas lidas para o cartão do Início (as mais recentes primeiro). */
export const LIMITE_FALHAS = 200;

/**
 * Mensagens vivas (pendente, enviando, enviada) que podem ser o reenvio de
 * alguma das falhas: mesmo tipo, mesma cliente ou pedido, criadas depois da
 * falha mais antiga. contarFalhasSemReenvio confere a chave completa.
 */
async function carregarReenvios(supabase: Supabase, falhas: LinhaChave[]): Promise<LinhaChave[]> {
  if (falhas.length === 0) return [];
  const unicos = (v: (string | null)[]) => [...new Set(v.filter((x): x is string => !!x))];
  const clientes = unicos(falhas.map((f) => f.cliente_id));
  const pedidos = unicos(falhas.map((f) => f.pedido_online_id));
  const filtros = [
    clientes.length > 0 ? `cliente_id.in.(${clientes.join(",")})` : null,
    pedidos.length > 0 ? `pedido_online_id.in.(${pedidos.join(",")})` : null,
  ].filter((f): f is string => f !== null);
  if (filtros.length === 0) return [];
  const maisAntiga = falhas.reduce(
    (min, f) => (new Date(f.criado_em).getTime() < new Date(min).getTime() ? f.criado_em : min),
    falhas[0].criado_em,
  );

  const { data, error } = await supabase
    .from("fila_mensagens")
    .select(SELECT_CHAVE)
    .in("status", ["pendente", "enviando", "enviada"])
    .in("tipo", unicos(falhas.map((f) => f.tipo)) as LinhaChave["tipo"][])
    .gt("criado_em", maisAntiga)
    .or(filtros.join(","))
    .limit(1000);
  falhou("as mensagens com falha", error);
  return (data ?? []) as unknown as LinhaChave[];
}

/**
 * Alertas do Início: conexão caída com o envio ligado, falhas dos últimos 7
 * dias e respostas não lidas que pedem atenção (quer remarcar e para ler).
 */
export async function carregarAlertasWhatsapp(
  supabase: Supabase,
  agora: Date = new Date(),
): Promise<AlertasWhatsapp> {
  const desde = new Date(agora.getTime() - DIAS_FALHAS * 86_400_000).toISOString();
  const [config, status, falhas, respostas] = await Promise.all([
    supabase.from("configuracoes_clinica").select("whatsapp_ativo").maybeSingle(),
    supabase.from("whatsapp_status").select("estado").maybeSingle(),
    supabase
      .from("fila_mensagens")
      .select(SELECT_CHAVE)
      .eq("status", "falhou")
      .gte("atualizado_em", desde)
      .order("atualizado_em", { ascending: false })
      .limit(LIMITE_FALHAS),
    supabase
      .from("mensagens_recebidas")
      .select(SELECT_RESPOSTA)
      .is("lida_em", null)
      .in("classificacao", ["quer_remarcar", "para_ler"])
      .order("recebida_em", { ascending: false })
      .limit(LIMITE_RESPOSTAS_INICIO),
  ]);
  falhou("a configuração do WhatsApp", config.error);
  falhou("o estado do WhatsApp", status.error);
  falhou("as mensagens com falha", falhas.error);
  const linhasFalhas = (falhas.data ?? []) as unknown as LinhaChave[];
  falhou("as respostas do WhatsApp", respostas.error);
  const reenvios = await carregarReenvios(supabase, linhasFalhas);

  const ativo = config.data?.whatsapp_ativo ?? false;
  return {
    desconectado: ativo && status.data?.estado !== "conectado",
    semChaves: ativo && status.data?.estado === "sem_chaves",
    falhas: contarFalhasSemReenvio([...linhasFalhas, ...reenvios]),
    respostas: ((respostas.data ?? []) as unknown as LinhaResposta[]).map(paraResposta),
  };
}

/** Envio automático ligado? (pedidos online: decide entre a fila e o botão manual). */
export async function envioWhatsappAtivo(supabase: Supabase): Promise<boolean> {
  const { data, error } = await supabase
    .from("configuracoes_clinica")
    .select("whatsapp_ativo")
    .maybeSingle();
  falhou("a configuração do WhatsApp", error);
  return data?.whatsapp_ativo ?? false;
}
