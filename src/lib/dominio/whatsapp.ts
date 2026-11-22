import type { Database } from "@/lib/supabase/tipos";
import { formatarNoFuso } from "./tempo";

export type TipoMensagem = Database["public"]["Enums"]["tipo_mensagem"];
export type StatusMensagem = Database["public"]["Enums"]["status_mensagem"];
export type ClassificacaoResposta = "confirmou" | "quer_remarcar" | "para_ler";

export const ROTULO_TIPO_MENSAGEM: Record<TipoMensagem, string> = {
  confirmacao: "Confirmação",
  lembrete: "Lembrete",
  pos_atendimento: "Pós-atendimento",
  aniversario: "Aniversário",
  pedido_aprovado: "Pedido aprovado",
  pedido_recusado: "Pedido recusado",
  avulsa: "Avulsa",
  retorno: "Retorno",
  reativacao: "Reativação",
  robo: "Robô",
};

export const ROTULO_STATUS_MENSAGEM: Record<StatusMensagem, string> = {
  pendente: "Pendente",
  enviando: "Enviando",
  enviada: "Enviada",
  falhou: "Falhou",
  cancelada: "Cancelada",
};

export const ROTULO_CLASSIFICACAO: Record<ClassificacaoResposta, string> = {
  para_ler: "Para ler",
  quer_remarcar: "Quer remarcar",
  confirmou: "Confirmou",
};

export const VARIAVEIS_MENSAGEM = [
  "nome",
  "data",
  "hora",
  "servico",
  "profissional",
  "clinica",
] as const;

/**
 * Iguais aos inseridos em supabase/migrations/0012_whatsapp.sql e 0015_crm.sql.
 * Avulsa e robô não têm modelo: o texto já vem pronto.
 */
export const TEXTOS_PADRAO: Record<Exclude<TipoMensagem, "avulsa" | "robo">, string> = {
  confirmacao:
    "Oi, {nome}! Passando para confirmar seu horário de {servico} com {profissional} em {data} às {hora}. Responda 1 para confirmar ou 2 para remarcar. {clinica}",
  lembrete:
    "Oi, {nome}! Lembrete: hoje às {hora} você tem {servico} com {profissional}. Te esperamos! {clinica}",
  pos_atendimento:
    "Oi, {nome}! Obrigada pela visita. Como você está se sentindo depois do {servico}? Qualquer dúvida, é só responder. {clinica}",
  aniversario:
    "Feliz aniversário, {nome}! 🎉 Toda a equipe da {clinica} deseja um dia lindo para você.",
  pedido_aprovado:
    "Oi, {nome}! Seu horário de {servico} com {profissional} está confirmado para {data} às {hora}. {clinica}",
  pedido_recusado:
    "Oi, {nome}! Infelizmente o horário pedido para {servico} não está disponível. Você pode escolher outro em nosso site ou responder esta mensagem. {clinica}",
  retorno:
    "Oi, {nome}! Já está na hora de renovar seu {servico}. Quer que a gente reserve um horário para você? {clinica}",
  reativacao:
    "Oi, {nome}! Sentimos sua falta aqui na {clinica}. Que tal agendar um momento para você? É só responder esta mensagem.",
};

export type DadosMensagem = {
  nome?: string;
  data?: string;
  hora?: string;
  servico?: string;
  profissional?: string;
  clinica?: string;
};

function primeiroNome(nome: string): string {
  return nome.trim().split(/\s+/)[0] ?? "";
}

/**
 * Sorteia uma variação e troca as variáveis. Variável sem valor vira vazio;
 * desconhecida fica literal. `{nome}` usa só o primeiro nome.
 */
export function renderizarMensagem(
  variacoes: string[],
  dados: DadosMensagem,
  sortear: (n: number) => number = (n) => Math.floor(Math.random() * n),
): string {
  if (variacoes.length === 0) return "";
  const modelo = variacoes[sortear(variacoes.length)] ?? variacoes[0];
  const valores: Record<string, string> = {
    nome: primeiroNome(dados.nome ?? ""),
    data: dados.data ?? "",
    hora: dados.hora ?? "",
    servico: dados.servico ?? "",
    profissional: dados.profissional ?? "",
    clinica: dados.clinica ?? "",
  };
  return modelo
    .replace(/\{(\w+)\}/g, (literal, chave: string) =>
      Object.hasOwn(valores, chave) ? valores[chave] : literal,
    )
    .trim();
}

/** Monta as variáveis a partir de uma linha de proxima_mensagem() (data/hora em SP). */
export function dadosDaMensagem(linha: {
  nome?: string | null;
  inicio?: string | null;
  servico?: string | null;
  profissional?: string | null;
  clinica?: string | null;
}): DadosMensagem {
  return {
    nome: linha.nome ?? undefined,
    data: linha.inicio ? formatarNoFuso(linha.inicio, "dd/MM") : undefined,
    hora: linha.inicio ? formatarNoFuso(linha.inicio, "HH:mm") : undefined,
    servico: linha.servico ?? undefined,
    profissional: linha.profissional ?? undefined,
    clinica: linha.clinica ?? undefined,
  };
}

/** "A", "A e B", "A, B e C". */
function juntarComE(itens: string[]): string {
  if (itens.length <= 1) return itens[0] ?? "";
  return `${itens.slice(0, -1).join(", ")} e ${itens[itens.length - 1]}`;
}

/**
 * Confirmação/lembrete de vários horários da cliente no mesmo dia viram uma
 * mensagem só: {servico} lista cada serviço com o horário, {hora} é o
 * primeiro horário e {profissional} junta os nomes sem repetir. Um item só:
 * devolve os dados de sempre.
 */
export function dadosDoDia(
  base: DadosMensagem,
  grupo: { inicio: string; servico: string; profissional: string }[],
): DadosMensagem {
  if (grupo.length <= 1) return base;
  const ordenado = [...grupo].sort(
    (a, b) => new Date(a.inicio).getTime() - new Date(b.inicio).getTime(),
  );
  return {
    ...base,
    data: formatarNoFuso(ordenado[0].inicio, "dd/MM"),
    hora: formatarNoFuso(ordenado[0].inicio, "HH:mm"),
    servico: juntarComE(
      ordenado.map((g) => `${g.servico} (${formatarNoFuso(g.inicio, "HH:mm")})`),
    ),
    profissional: juntarComE([...new Set(ordenado.map((g) => g.profissional))]),
  };
}

export function podeEnviar(
  tipo: TipoMensagem,
  statusAgendamento: string | null,
  inicio: Date | null,
  agora: Date,
): { ok: true } | { ok: false; motivo: string } {
  const futuro = inicio !== null && inicio.getTime() > agora.getTime();
  if (tipo === "confirmacao") {
    if (statusAgendamento !== "pendente")
      return { ok: false, motivo: "Agendamento não está mais pendente" };
    if (!futuro) return { ok: false, motivo: "Horário já passou" };
  } else if (tipo === "lembrete") {
    if (statusAgendamento !== "confirmado")
      return { ok: false, motivo: "Agendamento não está confirmado" };
    if (!futuro) return { ok: false, motivo: "Horário já passou" };
  } else if (tipo === "pos_atendimento") {
    if (statusAgendamento !== "atendido")
      return { ok: false, motivo: "Agendamento não foi atendido" };
  }
  return { ok: true };
}

/** Avulsa e robô vêm com o texto pronto na fila; os outros tipos são renderizados no envio. */
export function temTextoPronto(tipo: TipoMensagem): boolean {
  return tipo === "avulsa" || tipo === "robo";
}

export function classificarResposta(texto: string): ClassificacaoResposta {
  const v = texto.trim().toLowerCase();
  if (["1", "1.", "sim", "confirmo", "confirmar"].includes(v)) return "confirmou";
  if (["2", "2."].includes(v)) return "quer_remarcar";
  return "para_ler";
}
