// Anamnese: perguntas do modelo, respostas e regras (puro, sem I/O).

import { TZDate } from "@date-fns/tz";
import { subMonths } from "date-fns";
import { FUSO } from "./tempo";

export type TipoPergunta = "texto" | "sim_nao" | "sim_nao_detalhe" | "multipla" | "data";

export type Pergunta = {
  id: string;
  tipo: TipoPergunta;
  texto: string;
  obrigatoria: boolean;
  alerta?: boolean;
  opcoes?: string[];
};

/** texto: string; sim_nao: boolean; sim_nao_detalhe: objeto; multipla: string[]; data: yyyy-MM-dd. */
export type ValorResposta = string | boolean | { sim: boolean; detalhe?: string } | string[];
export type Respostas = Record<string, ValorResposta>;

export const ROTULO_TIPO_PERGUNTA: Record<TipoPergunta, string> = {
  texto: "Texto livre",
  sim_nao: "Sim ou não",
  sim_nao_detalhe: "Sim ou não, com detalhe",
  multipla: "Múltipla escolha",
  data: "Data",
};

const PODE_SER_ALERTA: readonly TipoPergunta[] = ["sim_nao", "sim_nao_detalhe"];

export function erroDasPerguntas(perguntas: Pergunta[]): string | null {
  if (perguntas.length === 0) return "Adicione ao menos uma pergunta.";
  if (perguntas.some((p) => !p.texto.trim())) return "Toda pergunta precisa de texto.";
  if (new Set(perguntas.map((p) => p.id)).size !== perguntas.length) {
    return "Há perguntas repetidas.";
  }
  if (
    perguntas.some(
      (p) => p.tipo === "multipla" && (p.opcoes ?? []).filter((o) => o.trim()).length < 2,
    )
  ) {
    return "Perguntas de múltipla escolha precisam de ao menos 2 opções.";
  }
  if (perguntas.some((p) => p.alerta && !PODE_SER_ALERTA.includes(p.tipo))) {
    return "Só perguntas de sim/não podem ser de alerta.";
  }
  return null;
}

/** Slug `^[a-z0-9_]{1,40}$` sem acento; `_2`, `_3`… se já existir. */
export function gerarIdPergunta(texto: string, existentes: string[]): string {
  const base =
    texto
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 30)
      .replace(/_+$/g, "") || "pergunta";
  if (!existentes.includes(base)) return base;
  for (let n = 2; ; n++) {
    const id = `${base}_${n}`;
    if (!existentes.includes(id)) return id;
  }
}

function normalizar(p: Pergunta) {
  return {
    id: p.id,
    tipo: p.tipo,
    texto: p.texto.trim(),
    obrigatoria: !!p.obrigatoria,
    alerta: !!p.alerta,
    opcoes: p.tipo === "multipla" ? (p.opcoes ?? []).map((o) => o.trim()) : [],
  };
}

/** Falso quando nada mudou (a ordem das perguntas importa). */
export function precisaNovaVersao(
  anteriores: Pergunta[],
  novas: Pergunta[],
  tituloAnterior: string,
  tituloNovo: string,
): boolean {
  if (tituloAnterior.trim() !== tituloNovo.trim()) return true;
  return JSON.stringify(anteriores.map(normalizar)) !== JSON.stringify(novas.map(normalizar));
}

function objetoSimDetalhe(v: ValorResposta | undefined): { sim: boolean; detalhe?: string } | null {
  return v && typeof v === "object" && !Array.isArray(v) ? v : null;
}

function respondida(p: Pergunta, v: ValorResposta | undefined): boolean {
  switch (p.tipo) {
    case "texto":
    case "data":
      return typeof v === "string" && v.trim() !== "";
    case "sim_nao":
      return typeof v === "boolean";
    case "sim_nao_detalhe":
      return objetoSimDetalhe(v) !== null && typeof objetoSimDetalhe(v)?.sim === "boolean";
    case "multipla":
      return Array.isArray(v) && v.length > 0;
  }
}

const MAX_TEXTO_RESPOSTA = 2000;

function dataValida(v: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) return false;
  const [ano, mes, dia] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const d = new Date(Date.UTC(ano, mes - 1, dia));
  return d.getUTCFullYear() === ano && d.getUTCMonth() === mes - 1 && d.getUTCDate() === dia;
}

/** Forma da resposta conforme o tipo da pergunta; "vazio" equivale a não respondida. */
function formaDaResposta(p: Pergunta, v: ValorResposta): "ok" | "vazio" | "invalida" {
  switch (p.tipo) {
    case "texto":
      if (typeof v !== "string" || v.length > MAX_TEXTO_RESPOSTA) return "invalida";
      return v.trim() === "" ? "vazio" : "ok";
    case "data":
      if (typeof v !== "string") return "invalida";
      if (v === "") return "vazio";
      return dataValida(v) ? "ok" : "invalida";
    case "sim_nao":
      return typeof v === "boolean" ? "ok" : "invalida";
    case "sim_nao_detalhe": {
      const o = objetoSimDetalhe(v);
      if (!o || typeof o.sim !== "boolean") return "invalida";
      if (o.detalhe !== undefined && (typeof o.detalhe !== "string" || o.detalhe.length > MAX_TEXTO_RESPOSTA))
        return "invalida";
      return "ok";
    }
    case "multipla": {
      if (!Array.isArray(v)) return "invalida";
      if (v.length === 0) return "vazio";
      const opcoes = p.opcoes ?? [];
      const unicas = new Set(v);
      if (unicas.size !== v.length) return "invalida";
      return v.every((o) => typeof o === "string" && opcoes.includes(o)) ? "ok" : "invalida";
    }
  }
}

export function errosDasRespostas(
  perguntas: Pergunta[],
  respostas: Respostas,
): Record<string, string> {
  const erros: Record<string, string> = {};
  for (const p of perguntas) {
    const v = respostas[p.id];
    const forma = v === undefined ? "vazio" : formaDaResposta(p, v);
    if (forma === "invalida") {
      erros[p.id] = `Resposta inválida: ${p.texto}`;
      continue;
    }
    if (forma === "vazio") {
      if (p.obrigatoria) erros[p.id] = `Responda: ${p.texto}`;
      continue;
    }
    const o = p.tipo === "sim_nao_detalhe" ? objetoSimDetalhe(v) : null;
    if (o?.sim && !String(o.detalhe ?? "").trim()) {
      erros[p.id] = `Conte mais sobre: ${p.texto}`;
    }
  }
  return erros;
}

export function alertasDaAnamnese(perguntas: Pergunta[], respostas: Respostas): string[] {
  const alertas: string[] = [];
  for (const p of perguntas) {
    if (!p.alerta) continue;
    const v = respostas[p.id];
    if (p.tipo === "sim_nao" && v === true) alertas.push(p.texto);
    if (p.tipo === "sim_nao_detalhe") {
      const o = objetoSimDetalhe(v);
      if (o?.sim) {
        const detalhe = String(o.detalhe ?? "").trim();
        alertas.push(detalhe ? `${p.texto} (${detalhe})` : p.texto);
      }
    }
  }
  return alertas;
}

function textoDaResposta(p: Pergunta, v: ValorResposta | undefined): string {
  if (!respondida(p, v)) return "—";
  switch (p.tipo) {
    case "texto":
      return String(v).trim();
    case "sim_nao":
      return v ? "Sim" : "Não";
    case "sim_nao_detalhe": {
      const o = objetoSimDetalhe(v)!;
      const detalhe = String(o.detalhe ?? "").trim();
      return o.sim ? (detalhe ? `Sim — ${detalhe}` : "Sim") : "Não";
    }
    case "multipla":
      return (v as string[]).join(", ");
    case "data":
      return String(v).split("-").reverse().join("/");
  }
}

/** Usa as perguntas da versão da própria anamnese, não as do modelo atual. */
export function respostasLegiveis(
  perguntas: Pergunta[],
  respostas: Respostas,
): { pergunta: string; resposta: string; alerta: boolean }[] {
  return perguntas.map((p) => ({
    pergunta: p.texto,
    resposta: textoDaResposta(p, respostas[p.id]),
    alerta: !!p.alerta,
  }));
}

/** Sem anamnese, ou a última é anterior a `agora − 12 meses` (fuso de São Paulo). */
export function anamnesePendente(ultimaEm: string | null, agora: Date): boolean {
  if (!ultimaEm) return true;
  const limite = subMonths(new TZDate(agora.getTime(), FUSO), 12);
  return new Date(ultimaEm).getTime() < limite.getTime();
}
