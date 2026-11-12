import "server-only";
import {
  ROTULO_TIPO_MENSAGEM,
  type ClassificacaoResposta,
  type StatusMensagem,
  type TipoMensagem,
} from "@/lib/dominio/whatsapp";
import { filtrarConversas, type FiltroConversas } from "@/features/mensagens/filtro-conversas";
import type { createClient } from "@/lib/supabase/server";

type Supabase = Awaited<ReturnType<typeof createClient>>;

export const LIMITE_RESPOSTAS = 200;
/** Respostas não lidas no cartão do Início. */
export const LIMITE_RESPOSTAS_INICIO = 10;
/** O cartão "Mensagens com falha" conta as falhas desta janela. */
export const DIAS_FALHAS = 7;

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

const SELECT_CHAVE =
  "status, tipo, cliente_id, agendamento_id, pedido_online_id, lead_id, telefone, criado_em";

/**
 * Chave de um WhatsApp brasileiro que junta as formas com e sem o 9 depois do
 * DDD: 55DD+8 dígitos vira 55DD+9+8 dígitos (o formato de clientes.whatsapp).
 * Outro formato fica como veio.
 */
export function chaveTelefone(telefone: string): string {
  return /^55\d{10}$/.test(telefone) ? `${telefone.slice(0, 4)}9${telefone.slice(4)}` : telefone;
}

/** As duas formas do número (com e sem o 9), como robo_telefones no banco. */
export function formasTelefone(telefone: string): string[] {
  if (/^55\d{10}$/.test(telefone)) return [telefone, `${telefone.slice(0, 4)}9${telefone.slice(4)}`];
  const m = /^55(\d{2})9(\d{8})$/.exec(telefone);
  return m ? [telefone, `55${m[1]}${m[2]}`] : [telefone];
}

export type LinhaChave = {
  status: StatusMensagem;
  tipo: TipoMensagem;
  cliente_id: string | null;
  agendamento_id: string | null;
  pedido_online_id: string | null;
  lead_id?: string | null;
  telefone?: string;
  criado_em: string;
};

/**
 * Falhas que ainda pedem atenção: "Tentar de novo" cria uma mensagem nova e a
 * antiga fica `falhou`; ela deixa de contar quando há uma mais nova, não
 * cancelada nem com falha, do mesmo tipo, cliente, lead e agendamento/pedido
 * (sem cliente, pedido nem lead — ex.: robô para número sem cadastro —, do
 * mesmo telefone, com ou sem o 9).
 */
export function contarFalhasSemReenvio(linhas: LinhaChave[]): number {
  const chave = (l: LinhaChave) =>
    [
      l.tipo,
      l.cliente_id ?? "",
      l.agendamento_id ?? "",
      l.pedido_online_id ?? "",
      l.lead_id ?? "",
      !l.cliente_id && !l.pedido_online_id && !l.lead_id ? chaveTelefone(l.telefone ?? "") : "",
    ].join("|");
  const ultimaViva = new Map<string, number>();
  for (const l of linhas) {
    if (l.status === "falhou") continue;
    const t = new Date(l.criado_em).getTime();
    const k = chave(l);
    ultimaViva.set(k, Math.max(ultimaViva.get(k) ?? -Infinity, t));
  }
  return linhas.filter(
    (l) =>
      l.status === "falhou" &&
      !((ultimaViva.get(chave(l)) ?? -Infinity) > new Date(l.criado_em).getTime()),
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
  const leads = unicos(falhas.map((f) => f.lead_id ?? null));
  const telefones = unicos(
    falhas
      .filter((f) => !f.cliente_id && !f.pedido_online_id && !f.lead_id)
      .flatMap((f) => formasTelefone(f.telefone ?? ""))
      .filter((t) => /^\d+$/.test(t)),
  );
  const filtros = [
    clientes.length > 0 ? `cliente_id.in.(${clientes.join(",")})` : null,
    pedidos.length > 0 ? `pedido_online_id.in.(${pedidos.join(",")})` : null,
    leads.length > 0 ? `lead_id.in.(${leads.join(",")})` : null,
    telefones.length > 0 ? `telefone.in.(${telefones.join(",")})` : null,
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

export const LIMITE_CONVERSA = 100;

export type ItemConversa = {
  id: string;
  direcao: "recebida" | "enviada";
  texto: string;
  quando: string;
  status?: StatusMensagem;
  tipo?: TipoMensagem;
  /** Só enviadas: motivo da falha / do cancelamento (para o balão). */
  erro?: string | null;
  canceladaMotivo?: string | null;
};

type LinhaRecebida = { id: string; texto: string; recebida_em: string };
type LinhaEnviada = {
  id: string;
  texto: string | null;
  status: StatusMensagem;
  tipo: TipoMensagem;
  enviada_em: string | null;
  agendado_para: string;
  erro?: string | null;
  cancelada_motivo?: string | null;
};

/** Junta recebidas e enviadas, ordena por horário (estável) e fica com as últimas 100. */
export function montarConversa(
  recebidas: LinhaRecebida[],
  enviadas: LinhaEnviada[],
): ItemConversa[] {
  const itens: ItemConversa[] = [
    ...recebidas.map((r) => ({
      id: r.id,
      direcao: "recebida" as const,
      texto: r.texto,
      quando: r.recebida_em,
    })),
    ...enviadas.map((e) => ({
      id: e.id,
      direcao: "enviada" as const,
      texto: e.texto ?? `(mensagem automática: ${ROTULO_TIPO_MENSAGEM[e.tipo]})`,
      quando: e.enviada_em ?? e.agendado_para,
      status: e.status,
      tipo: e.tipo,
      erro: e.erro ?? null,
      canceladaMotivo: e.cancelada_motivo ?? null,
    })),
  ];
  itens.sort((a, b) => new Date(a.quando).getTime() - new Date(b.quando).getTime());
  return itens.slice(-LIMITE_CONVERSA);
}

/** Conversa com a cliente: o que ela mandou e tudo o que a clínica enviou ou agendou (últimas 100). */
export async function carregarConversa(
  supabase: Supabase,
  clienteId: string,
): Promise<ItemConversa[]> {
  const [recebidas, enviadas] = await Promise.all([
    supabase
      .from("mensagens_recebidas")
      .select("id, texto, recebida_em")
      .eq("cliente_id", clienteId)
      .order("recebida_em", { ascending: false })
      .limit(LIMITE_CONVERSA),
    supabase
      .from("fila_mensagens")
      .select("id, texto, status, tipo, enviada_em, agendado_para, erro, cancelada_motivo")
      .eq("cliente_id", clienteId)
      .order("agendado_para", { ascending: false })
      .limit(LIMITE_CONVERSA),
  ]);
  falhou("as mensagens recebidas", recebidas.error);
  falhou("as mensagens enviadas", enviadas.error);
  return montarConversa(
    (recebidas.data ?? []) as unknown as LinhaRecebida[],
    (enviadas.data ?? []) as unknown as LinhaEnviada[],
  );
}

/** Conversas mostradas na tela (as mais recentes, depois dos filtros). */
export const LIMITE_CONVERSAS = 500;
/** Recebidas lidas para montar a lista (as mais recentes). */
export const LIMITE_RECEBIDAS = 500;
/** Mensagens da clínica lidas para montar a lista (as de agendamento mais recente). */
export const LIMITE_ENVIADAS = 2000;

export type ResumoConversa = {
  /** `cliente_id` quando houver; senão o telefone (conversa "sem cadastro"). */
  chave: string;
  clienteId: string | null;
  /** Conversa de lead (sem cliente): mensagens avulsas enviadas pelo CRM. */
  leadId: string | null;
  nome: string | null;
  telefone: string;
  ultima: { texto: string; quando: string; direcao: "recebida" | "enviada" };
  naoLidas: number;
  idsNaoLidos: string[];
  /** Classificação da última recebida (nulo se a cliente nunca respondeu). */
  classificacao: ClassificacaoResposta | null;
  /** Há mensagem `falhou` sem reenvio posterior. */
  falhou: boolean;
  /** Status e tipo de cada mensagem da clínica (futuras incluídas), para os filtros. */
  enviadas: { status: StatusMensagem; tipo: TipoMensagem }[];
};

export type LinhaConversaRecebida = {
  id: string;
  telefone: string;
  texto: string;
  recebida_em: string;
  classificacao: ClassificacaoResposta;
  lida_em: string | null;
  cliente_id: string | null;
  clientes: { nome: string } | null;
};

export type LinhaConversaEnviada = {
  id: string;
  telefone: string;
  texto: string | null;
  status: StatusMensagem;
  tipo: TipoMensagem;
  enviada_em: string | null;
  agendado_para: string;
  cliente_id: string | null;
  agendamento_id?: string | null;
  pedido_online_id?: string | null;
  criado_em?: string;
  lead_id?: string | null;
  clientes?: { nome: string } | null;
  leads?: { nome: string } | null;
};

const instante = (v: string) => new Date(v).getTime();

/**
 * Uma conversa por cliente (ou por telefone, sem cadastro), com recebidas e/ou
 * mensagens da clínica. A prévia e a ordem usam só o que já saiu (enviadas, ou
 * pendentes com horário vencido; canceladas, com falha e futuras não contam),
 * exceto numa conversa sem recebidas e sem nada que já saiu: aí vale a mais
 * recente de qualquer status. Futuras contam para os filtros de status/tipo.
 */
export function agruparConversas(
  recebidas: LinhaConversaRecebida[],
  enviadas: LinhaConversaEnviada[],
  agora: Date = new Date(),
): ResumoConversa[] {
  const recebidasPor = new Map<string, LinhaConversaRecebida[]>();
  for (const r of recebidas) {
    // Sem cadastro: o mesmo número com e sem o 9 é uma conversa só.
    const chave = r.cliente_id ?? chaveTelefone(r.telefone);
    recebidasPor.set(chave, [...(recebidasPor.get(chave) ?? []), r]);
  }
  const enviadasPor = new Map<string, LinhaConversaEnviada[]>();
  for (const e of enviadas) {
    const chave = e.cliente_id ?? chaveTelefone(e.telefone);
    enviadasPor.set(chave, [...(enviadasPor.get(chave) ?? []), e]);
  }

  const quandoEnviada = (e: LinhaConversaEnviada) => e.enviada_em ?? e.agendado_para;
  const textoEnviada = (e: LinhaConversaEnviada) =>
    e.texto ?? `(mensagem automática: ${ROTULO_TIPO_MENSAGEM[e.tipo]})`;
  const jaSaiu = (e: LinhaConversaEnviada) =>
    e.status === "enviada" ||
    ((e.status === "pendente" || e.status === "enviando") &&
      instante(e.agendado_para) <= agora.getTime());

  const conversas: ResumoConversa[] = [];
  for (const chave of new Set([...recebidasPor.keys(), ...enviadasPor.keys()])) {
    const recentes = [...(recebidasPor.get(chave) ?? [])].sort(
      (a, b) => instante(b.recebida_em) - instante(a.recebida_em),
    );
    const doGrupo = enviadasPor.get(chave) ?? [];
    const porData = (lista: LinhaConversaEnviada[]) =>
      [...lista].sort((a, b) => instante(quandoEnviada(b)) - instante(quandoEnviada(a)))[0];
    const ultimaRecebida = recentes[0];
    const ultimaSaida = porData(doGrupo.filter(jaSaiu));
    const candidataSemRecebida = ultimaRecebida ? undefined : (ultimaSaida ?? porData(doGrupo));

    const ultima: ResumoConversa["ultima"] =
      ultimaSaida &&
      (!ultimaRecebida || instante(quandoEnviada(ultimaSaida)) > instante(ultimaRecebida.recebida_em))
        ? {
            texto: textoEnviada(ultimaSaida),
            quando: quandoEnviada(ultimaSaida),
            direcao: "enviada",
          }
        : ultimaRecebida
          ? { texto: ultimaRecebida.texto, quando: ultimaRecebida.recebida_em, direcao: "recebida" }
          : {
              texto: textoEnviada(candidataSemRecebida!),
              quando: quandoEnviada(candidataSemRecebida!),
              direcao: "enviada",
            };

    const naoLidas = recentes.filter((r) => r.lida_em === null);
    const clienteId = ultimaRecebida?.cliente_id ?? doGrupo.find((e) => e.cliente_id)?.cliente_id ?? null;
    conversas.push({
      chave,
      clienteId,
      leadId: clienteId ? null : (doGrupo.find((e) => e.lead_id)?.lead_id ?? null),
      nome:
        recentes.find((r) => r.clientes)?.clientes?.nome ??
        doGrupo.find((e) => e.clientes)?.clientes?.nome ??
        (clienteId ? null : (doGrupo.find((e) => e.leads)?.leads?.nome ?? null)),
      telefone: ultimaRecebida?.telefone ?? porData(doGrupo).telefone,
      ultima,
      naoLidas: naoLidas.length,
      idsNaoLidos: naoLidas.map((r) => r.id),
      classificacao: ultimaRecebida?.classificacao ?? null,
      falhou:
        contarFalhasSemReenvio(
          doGrupo.map((e) => ({
            status: e.status,
            tipo: e.tipo,
            cliente_id: e.cliente_id,
            agendamento_id: e.agendamento_id ?? null,
            pedido_online_id: e.pedido_online_id ?? null,
            lead_id: e.lead_id ?? null,
            telefone: e.telefone,
            criado_em: e.criado_em ?? e.agendado_para,
          })),
        ) > 0,
      enviadas: doGrupo.map((e) => ({ status: e.status, tipo: e.tipo })),
    });
  }
  return conversas.sort((a, b) => instante(b.ultima.quando) - instante(a.ultima.quando));
}

/**
 * Conversas da tela de Mensagens, a mais recente primeiro: lê as últimas 500
 * recebidas e as últimas 2000 mensagens da clínica, agrupa, filtra e fica com
 * até 500 conversas.
 */
export async function carregarConversas(
  supabase: Supabase,
  filtro: FiltroConversas = {},
): Promise<ResumoConversa[]> {
  const [recebidas, enviadas] = await Promise.all([
    supabase
      .from("mensagens_recebidas")
      .select(
        "id, telefone, texto, recebida_em, classificacao, lida_em, cliente_id, clientes(nome)",
      )
      .order("recebida_em", { ascending: false })
      .limit(LIMITE_RECEBIDAS),
    supabase
      .from("fila_mensagens")
      .select(
        "id, telefone, texto, status, tipo, enviada_em, agendado_para, cliente_id, agendamento_id, pedido_online_id, criado_em, lead_id, clientes(nome), leads(nome)",
      )
      .order("agendado_para", { ascending: false })
      .limit(LIMITE_ENVIADAS),
  ]);
  falhou("as respostas do WhatsApp", recebidas.error);
  falhou("as mensagens enviadas", enviadas.error);

  return filtrarConversas(
    agruparConversas(
      (recebidas.data ?? []) as unknown as LinhaConversaRecebida[],
      (enviadas.data ?? []) as unknown as LinhaConversaEnviada[],
    ),
    filtro,
  ).slice(0, LIMITE_CONVERSAS);
}

/** Conversa de um número sem cadastro: recebidas e enviadas pelo telefone (com e sem o 9). */
export async function carregarConversaPorTelefone(
  supabase: Supabase,
  telefone: string,
): Promise<ItemConversa[]> {
  const [recebidas, enviadas] = await Promise.all([
    supabase
      .from("mensagens_recebidas")
      .select("id, texto, recebida_em")
      .in("telefone", formasTelefone(telefone))
      .is("cliente_id", null)
      .order("recebida_em", { ascending: false })
      .limit(LIMITE_CONVERSA),
    supabase
      .from("fila_mensagens")
      .select("id, texto, status, tipo, enviada_em, agendado_para, erro, cancelada_motivo")
      .in("telefone", formasTelefone(telefone))
      .is("cliente_id", null)
      .order("agendado_para", { ascending: false })
      .limit(LIMITE_CONVERSA),
  ]);
  falhou("as mensagens recebidas", recebidas.error);
  falhou("as mensagens enviadas", enviadas.error);
  return montarConversa(
    (recebidas.data ?? []) as unknown as LinhaRecebida[],
    (enviadas.data ?? []) as unknown as LinhaEnviada[],
  );
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

export type PausaRobo = { telefone: string; pausadoAte: string };

/**
 * Pausa do robô de atendimento na conversa (0017): a sessão da cliente (pelo
 * cliente_id) ou do número sem cadastro, se `pausado_ate` ainda não passou.
 * Com mais de uma sessão (WhatsApp com e sem o 9), vale a pausa mais longa.
 */
export async function carregarPausaRobo(
  supabase: Supabase,
  conversa: { clienteId: string | null; telefone: string },
  agora: Date = new Date(),
): Promise<PausaRobo | null> {
  const base = supabase.from("robo_sessoes").select("telefone, pausado_ate");
  const consulta = conversa.clienteId
    ? base.eq("cliente_id", conversa.clienteId)
    : base.eq("telefone", conversa.telefone);
  const { data, error } = await consulta.gt("pausado_ate", agora.toISOString());
  falhou("a pausa do robô", error);
  const linhas = (data ?? []) as { telefone: string; pausado_ate: string | null }[];
  const maior = linhas
    .filter((l): l is { telefone: string; pausado_ate: string } => l.pausado_ate !== null)
    .sort((a, b) => instante(b.pausado_ate) - instante(a.pausado_ate))[0];
  return maior ? { telefone: maior.telefone, pausadoAte: maior.pausado_ate } : null;
}

/**
 * Alerta do Início: quantas pediram atendimento ao robô nas últimas 24 h e
 * ainda não receberam mensagem da equipe (robo_pedidos_atendimento, 0017).
 */
export async function contarPedidosAtendimento(supabase: Supabase): Promise<number> {
  const { data, error } = await supabase.rpc("robo_pedidos_atendimento");
  falhou("os pedidos de atendimento", error);
  return typeof data === "number" ? data : 0;
}
