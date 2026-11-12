import "server-only";
import {
  aniversariantesEntre,
  ETAPAS_ABERTAS,
  type EtapaLead,
  classificarEnvio,
  situacaoRetorno,
  somarDias,
  type EnvioMarketing,
} from "@/lib/dominio/crm";
import { dataNoFuso } from "@/lib/dominio/tempo";
import { TEXTOS_PADRAO, type StatusMensagem } from "@/lib/dominio/whatsapp";
import type { createClient } from "@/lib/supabase/server";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** Retornos mostrados: até hoje + 7 dias. */
export const DIAS_RETORNO = 7;
/** Aniversariantes: hoje e os próximos 7 dias. */
export const DIAS_ANIVERSARIANTES = 7;
/** Tamanho da página ao ler clientes (o PostgREST corta em 1000 linhas). */
export const TAMANHO_PAGINA = 1000;

export type Retorno = {
  clienteId: string;
  clienteNome: string;
  servicoNome: string;
  agendamentoId: string;
  ultimoAtendimento: string;
  dataRetorno: string;
  situacao: "atrasado" | "semana";
  retornoEnviadoEm: string | null;
  envio: EnvioMarketing;
};

export type Sumida = {
  clienteId: string;
  nome: string;
  ultimoAtendimento: string;
  diasSemVir: number;
  aceitaMarketing: boolean;
  reativacaoEnviadaEm: string | null;
  /** Nunca "enviado": a carência da reativação é tratada pelo banco ("puladas"). */
  envio: Exclude<EnvioMarketing, "enviado">;
};

export type Aniversariante = {
  clienteId: string;
  nome: string;
  /** Dia do aniversário dentro do período (yyyy-MM-dd). */
  dia: string;
  idade: number;
  aceitaMarketing: boolean;
  envio: Exclude<EnvioMarketing, "enviado">;
  /** Status da mensagem `aniversario` do ano; nulo se ainda não entrou na fila. */
  statusFila: StatusMensagem | null;
};

function falhou(onde: string, error: { message: string } | null) {
  if (error) throw new Error(`Falha ao carregar ${onde}: ${error.message}`);
}

export async function carregarRetornos(supabase: Supabase, hoje: string): Promise<Retorno[]> {
  const { data, error } = await supabase.rpc("crm_retornos", {
    p_ate: somarDias(hoje, DIAS_RETORNO),
  });
  falhou("os retornos", error);
  return (data ?? []).map((r) => ({
    clienteId: r.cliente_id,
    clienteNome: r.cliente_nome,
    servicoNome: r.servico_nome,
    agendamentoId: r.agendamento_id,
    ultimoAtendimento: r.ultimo_atendimento,
    dataRetorno: r.data_retorno,
    situacao: situacaoRetorno(r.data_retorno, hoje),
    retornoEnviadoEm: r.retorno_enviado_em,
    envio: classificarEnvio({
      whatsapp: r.whatsapp,
      aceitaMarketing: r.aceita_marketing,
      enviadoEm: r.retorno_enviado_em,
    }),
  }));
}

export async function carregarSumidas(supabase: Supabase): Promise<Sumida[]> {
  const { data, error } = await supabase.rpc("crm_sumidas");
  falhou("as clientes sumidas", error);
  return (data ?? []).map((r) => ({
    clienteId: r.cliente_id,
    nome: r.nome,
    ultimoAtendimento: r.ultimo_atendimento,
    diasSemVir: r.dias_sem_vir,
    aceitaMarketing: r.aceita_marketing,
    reativacaoEnviadaEm: r.reativacao_enviada_em,
    envio: classificarEnvio({ whatsapp: r.whatsapp, aceitaMarketing: r.aceita_marketing }) as Sumida["envio"],
  }));
}

export async function carregarAniversariantes(
  supabase: Supabase,
  hoje: string,
): Promise<Aniversariante[]> {
  const clientes: {
    id: string;
    nome: string;
    whatsapp: string | null;
    aceita_whatsapp_marketing: boolean;
    data_nascimento: string | null;
  }[] = [];
  for (let de = 0; ; de += TAMANHO_PAGINA) {
    const { data, error } = await supabase
      .from("clientes")
      .select("id, nome, whatsapp, aceita_whatsapp_marketing, data_nascimento")
      .eq("ativo", true)
      .not("data_nascimento", "is", null)
      .order("id")
      .range(de, de + TAMANHO_PAGINA - 1);
    falhou("as clientes", error);
    clientes.push(...(data ?? []));
    if ((data?.length ?? 0) < TAMANHO_PAGINA) break;
  }

  const lista = aniversariantesEntre(clientes, hoje, somarDias(hoje, DIAS_ANIVERSARIANTES));
  if (lista.length === 0) return [];

  const { data: fila, error: erroFila } = await supabase
    .from("fila_mensagens")
    .select("cliente_id, status, agendado_para, enviada_em, criado_em")
    .eq("tipo", "aniversario")
    .in("cliente_id", [...new Set(lista.map((c) => c.id))])
    .gte("agendado_para", `${Number(hoje.slice(0, 4)) - 1}-12-31T00:00:00Z`)
    .order("criado_em", { ascending: true });
  falhou("a fila de aniversários", erroFila);

  // Mais recente por cliente e ano (SP): a última linha vence.
  const porClienteAno = new Map<string, StatusMensagem>();
  for (const f of fila ?? []) {
    if (!f.cliente_id) continue;
    porClienteAno.set(`${f.cliente_id}|${dataNoFuso(f.agendado_para).slice(0, 4)}`, f.status);
  }

  return lista.map((c) => ({
    clienteId: c.id,
    nome: c.nome,
    dia: c.dia,
    idade: c.idade,
    aceitaMarketing: c.aceita_whatsapp_marketing,
    envio: classificarEnvio({
      whatsapp: c.whatsapp,
      aceitaMarketing: c.aceita_whatsapp_marketing,
    }) as Aniversariante["envio"],
    statusFila: porClienteAno.get(`${c.id}|${c.dia.slice(0, 4)}`) ?? null,
  }));
}

export type ModeloReativacao = { variacoes: string[]; ativo: boolean; clinica: string };

/** Texto atual do modelo `reativacao` (cai no padrão se não puder ler). */
export async function carregarModeloReativacao(supabase: Supabase): Promise<ModeloReativacao> {
  const [{ data: modelo }, { data: clinica }] = await Promise.all([
    supabase.from("modelos_mensagem").select("variacoes, ativo").eq("tipo", "reativacao").maybeSingle(),
    supabase.from("configuracoes_clinica").select("nome").maybeSingle(),
  ]);
  const variacoes = modelo?.variacoes?.length ? modelo.variacoes : [TEXTOS_PADRAO.reativacao];
  return { variacoes, ativo: modelo?.ativo ?? true, clinica: clinica?.nome ?? "Madame Fê Clinic" };
}

/** Leads "agendou" e "perdido" aparecem só se mexidos nos últimos 60 dias. */
export const DIAS_LEADS_ENCERRADOS = 60;

export type Lead = {
  id: string;
  nome: string;
  whatsapp: string | null;
  etapa: EtapaLead;
  origem: string | null;
  observacoes: string | null;
  perdidoMotivo: string | null;
  servicoId: string | null;
  servicoNome: string | null;
  responsavelId: string | null;
  responsavelNome: string | null;
  clienteId: string | null;
  criadoEm: string;
};

type LinhaLead = {
  id: string;
  nome: string;
  whatsapp: string | null;
  etapa: EtapaLead;
  origem: string | null;
  observacoes: string | null;
  perdido_motivo: string | null;
  servico_id: string | null;
  responsavel_id: string | null;
  cliente_id: string | null;
  criado_em: string;
  servicos: { nome: string } | null;
  colaboradores: { nome: string } | null;
};

const SELECT_LEAD =
  "id, nome, whatsapp, etapa, origem, observacoes, perdido_motivo, servico_id, responsavel_id, cliente_id, criado_em, servicos(nome), colaboradores!leads_responsavel_id_fkey(nome)";

/** Leads abertos, mais agendou/perdido atualizados nos últimos 60 dias. */
export async function carregarLeads(supabase: Supabase, agora: Date = new Date()): Promise<Lead[]> {
  const corte = new Date(agora.getTime() - DIAS_LEADS_ENCERRADOS * 86_400_000).toISOString();
  const { data, error } = await supabase
    .from("leads")
    .select(SELECT_LEAD)
    .or(`etapa.in.(${ETAPAS_ABERTAS.join(",")}),atualizado_em.gte.${corte}`)
    .order("criado_em", { ascending: false })
    .limit(LIMITE_LEADS);
  falhou("os leads", error);
  return ((data ?? []) as unknown as LinhaLead[]).map((l) => ({
    id: l.id,
    nome: l.nome,
    whatsapp: l.whatsapp,
    etapa: l.etapa,
    origem: l.origem,
    observacoes: l.observacoes,
    perdidoMotivo: l.perdido_motivo,
    servicoId: l.servico_id,
    servicoNome: l.servicos?.nome ?? null,
    responsavelId: l.responsavel_id,
    responsavelNome: l.colaboradores?.nome ?? null,
    clienteId: l.cliente_id,
    criadoEm: l.criado_em,
  }));
}

const LIMITE_LEADS = 1000;

export type OpcoesLead = {
  servicos: { id: string; nome: string }[];
  responsaveis: { id: string; nome: string }[];
};

/**
 * Serviços e colaboradoras ativos, para os campos do formulário do lead. O
 * serviço/responsável atual de cada lead entra mesmo inativo ("<nome> (inativo)"),
 * para a edição não apagar o vínculo sem querer.
 */
export async function carregarOpcoesLead(supabase: Supabase, leads: Lead[] = []): Promise<OpcoesLead> {
  const [servicos, colaboradores] = await Promise.all([
    supabase.from("servicos").select("id, nome").eq("ativo", true).order("nome"),
    supabase.from("colaboradores").select("id, nome").eq("ativo", true).order("nome"),
  ]);
  falhou("os serviços", servicos.error);
  falhou("a equipe", colaboradores.error);
  const comInativos = (
    ativos: { id: string; nome: string }[],
    atuais: { id: string | null; nome: string | null }[],
  ) => {
    const lista = [...ativos];
    for (const a of atuais) {
      if (a.id && !lista.some((o) => o.id === a.id)) {
        lista.push({ id: a.id, nome: `${a.nome ?? "—"} (inativo)` });
      }
    }
    return lista;
  };
  return {
    servicos: comInativos(
      servicos.data ?? [],
      leads.map((l) => ({ id: l.servicoId, nome: l.servicoNome })),
    ),
    responsaveis: comInativos(
      colaboradores.data ?? [],
      leads.map((l) => ({ id: l.responsavelId, nome: l.responsavelNome })),
    ),
  };
}
