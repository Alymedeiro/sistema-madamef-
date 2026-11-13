import type { TipoNotificacao } from "@/lib/supabase/tipos";
import type { Perfil } from "@/lib/dominio/permissoes";

// Módulo puro (sem "use client"): regras das notificações, testadas no Vitest.

export type { TipoNotificacao };

export const TIPOS_NOTIFICACAO: readonly TipoNotificacao[] = [
  "mensagem_recebida",
  "pedido_online",
  "confirmou",
  "quer_remarcar",
  "pediu_equipe",
  "agenda_profissional",
  "mensagem_falhou",
];

export const ROTULO_TIPO_NOTIFICACAO: Record<TipoNotificacao, string> = {
  mensagem_recebida: "Mensagens recebidas no WhatsApp",
  pedido_online: "Pedidos de agendamento online",
  confirmou: "Cliente confirmou o horário",
  quer_remarcar: "Cliente quer remarcar",
  pediu_equipe: "Cliente pediu para falar com a equipe",
  agenda_profissional: "Mudanças na minha agenda",
  mensagem_falhou: "Mensagens que não foram enviadas",
};

export type Notificacao = {
  id: string;
  tipo: TipoNotificacao;
  titulo: string;
  corpo: string | null;
  link: string;
  criada_em: string;
  lida_em: string | null;
};

export type Preferencias = {
  som: boolean;
  volume: number;
  desktop: boolean;
  tipos: TipoNotificacao[];
};

export const PREFERENCIAS_PADRAO: Preferencias = {
  som: true,
  volume: 40,
  desktop: true,
  tipos: [...TIPOS_NOTIFICACAO],
};

/** Intervalo mínimo entre dois sons (várias notificações juntas = um som só). */
export const INTERVALO_SOM_MS = 4_000;
/** Ao reconectar, só as criadas nos últimos 60 s viram toast (as antigas só entram na lista). */
export const JANELA_RECENTE_MS = 60_000;
/** Quantas notificações a lista do sininho guarda. */
export const MAX_NA_LISTA = 30;

const ehTipo = (t: unknown): t is TipoNotificacao =>
  typeof t === "string" && (TIPOS_NOTIFICACAO as readonly string[]).includes(t);

const limitarVolume = (v: number) => Math.min(100, Math.max(0, Math.round(v)));

/** Linha de preferencias_notificacao (ou nenhuma) → preferências válidas. */
export function normalizarPreferencias(
  linha: { som: boolean; volume: number; desktop: boolean; tipos: readonly string[] } | null,
): Preferencias {
  if (!linha) return { ...PREFERENCIAS_PADRAO, tipos: [...PREFERENCIAS_PADRAO.tipos] };
  return {
    som: linha.som,
    volume: limitarVolume(linha.volume),
    desktop: linha.desktop,
    tipos: linha.tipos.filter(ehTipo),
  };
}

export function tipoPermitido(prefs: Preferencias, tipo: TipoNotificacao): boolean {
  return prefs.tipos.includes(tipo);
}

/** Devolve uma função que diz se pode tocar agora (no máximo 1 som a cada `intervaloMs`). */
export function criarLimitadorSom(intervaloMs: number = INTERVALO_SOM_MS): (agora: number) => boolean {
  let ultimo = -Infinity;
  return (agora) => {
    if (agora - ultimo < intervaloMs) return false;
    ultimo = agora;
    return true;
  };
}

export type PermissaoComputador = "granted" | "denied" | "default" | "indisponivel";

/**
 * Como avisar de uma notificação nova: tipo desligado → nada. Tela visível →
 * toast. Tela escondida → notificação do computador (se permitida e ligada);
 * senão toast, para ser visto ao voltar. Som conforme a preferência.
 */
export function decidirAvisos(p: {
  tipo: TipoNotificacao;
  prefs: Preferencias;
  visivel: boolean;
  permissao: PermissaoComputador;
}): { toast: boolean; som: boolean; desktop: boolean } {
  if (!tipoPermitido(p.prefs, p.tipo)) return { toast: false, som: false, desktop: false };
  const desktop = !p.visivel && p.prefs.desktop && p.permissao === "granted";
  return { toast: !desktop, som: p.prefs.som && p.prefs.volume > 0, desktop };
}

/** Só rotas internas ("/algo"); qualquer outra coisa vai para /inicio. */
export function linkSeguro(link: string | null | undefined): string {
  if (!link || !link.startsWith("/") || link.startsWith("//") || link.startsWith("/\\")) {
    return "/inicio";
  }
  return link;
}

export function ehRecente(criadaEm: string, agora: number, janelaMs: number = JANELA_RECENTE_MS): boolean {
  const t = Date.parse(criadaEm);
  return Number.isFinite(t) && agora - t <= janelaMs;
}

/** Junta listas sem repetir id (a versão de `novas` vale), mais novas primeiro. */
export function mesclarNotificacoes(
  atual: readonly Notificacao[],
  novas: readonly Notificacao[],
  limite: number = MAX_NA_LISTA,
): Notificacao[] {
  const porId = new Map<string, Notificacao>();
  for (const x of atual) porId.set(x.id, x);
  for (const x of novas) porId.set(x.id, x);
  return [...porId.values()]
    .sort((a, b) => Date.parse(b.criada_em) - Date.parse(a.criada_em) || b.id.localeCompare(a.id))
    .slice(0, limite);
}

/**
 * Som calmo: dois tons senoidais em sequência, 180 ms cada, ataque de 20 ms e
 * decaimento exponencial; ganho máximo = volume/100 × 0,15.
 */
export function planoSom(volume: number): {
  tons: { frequencia: number; inicio: number; duracao: number }[];
  ataque: number;
  ganho: number;
} {
  return {
    tons: [
      { frequencia: 660, inicio: 0, duracao: 0.18 },
      { frequencia: 880, inicio: 0.18, duracao: 0.18 },
    ],
    ataque: 0.02,
    ganho: (limitarVolume(volume) / 100) * 0.15,
  };
}

const FORMATO_DATA_HORA = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

/** "agora", "há 5 min", "há 2 h" ou "14/11 às 15:00" (São Paulo). */
export function quandoNotificacao(criadaEm: string, agora: number = Date.now()): string {
  const t = Date.parse(criadaEm);
  if (!Number.isFinite(t)) return "";
  const min = Math.floor((agora - t) / 60_000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  if (min < 12 * 60) return `há ${Math.floor(min / 60)} h`;
  const partes = Object.fromEntries(FORMATO_DATA_HORA.formatToParts(new Date(t)).map((p) => [p.type, p.value]));
  return `${partes.day}/${partes.month} às ${partes.hour}:${partes.minute}`;
}

/**
 * Tipos que cada perfil recebe (gatilhos de 0019): dona e recepção recebem os
 * da equipe; a profissional, os do próprio agendamento. A dona também pode
 * atender (profissional do agendamento) e por isso vê "Mudanças na minha agenda".
 */
export function tiposDoPerfil(perfil: Perfil): TipoNotificacao[] {
  if (perfil === "profissional") return ["confirmou", "quer_remarcar", "agenda_profissional"];
  if (perfil === "recepcao") return TIPOS_NOTIFICACAO.filter((t) => t !== "agenda_profissional");
  return [...TIPOS_NOTIFICACAO];
}
