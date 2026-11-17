// Importação de modelo de anamnese a partir de texto (colado ou extraído de PDF). Puro, sem I/O.

import { gerarIdPergunta, type Pergunta, type TipoPergunta } from "./anamnese";

export type PerguntaImportada = {
  texto: string;
  tipo: TipoPergunta;
  opcoes?: string[];
  incluir: boolean;
  obrigatoria?: boolean;
};

export const LIMITE_TEXTO_IMPORTADO = 20_000;
export const LIMITE_PDF_BYTES = 10 * 1024 * 1024;
/** Abaixo disso o PDF é tratado como foto/escaneado. */
export const MINIMO_CARACTERES_UTEIS = 20;
/** Linhas maiores são cortadas: nenhuma pergunta real passa disso. */
export const MAX_CARACTERES_LINHA = 1000;

/** Corta no limite do texto importado (o mesmo do colar). */
export function limitarTexto(texto: string): { texto: string; truncado: boolean } {
  return texto.length > LIMITE_TEXTO_IMPORTADO
    ? { texto: texto.slice(0, LIMITE_TEXTO_IMPORTADO), truncado: true }
    : { texto, truncado: false };
}

const MARCADOR = /\(\s*[xX]?\s*\)|\[\s*[xX]?\s*\]|[☐□▢❑○◯]/g;
const TEM_MARCADOR = /\(\s*[xX]?\s*\)|\[\s*[xX]?\s*\]|[☐□▢❑○◯]/;
const S_N = /(?:^|\s)S\s*\/\s*N\.?$/i;
const NUMERACAO = /^(?:\d{1,3}\s*[.)\-–—]|[a-zA-Z]\))\s*/;
const PAGINA = /^(?:p[aá]g(?:ina)?\.?\s*)?\d{1,3}\s*(?:(?:de|\/)\s*\d{1,3})?$|^[-–—]\s*\d{1,3}\s*[-–—]$/i;
const SO_TRACOS = /^[\s_.\-–—…=*]+$/;
// Começa com um "_" só (sem "_+") para não reprocessar sequências longas de sublinhados.
const CAMPO_DATA = /_\s*\/\s*_+\s*\/\s*_|\bdd\s*\/\s*mm\s*\/\s*a{2,4}\b/i;
const DETALHE = /\b(?:qual|quais|especifique|se sim|caso sim|descreva)\b/i;
const INICIO_DETALHE = /^(?:se sim|caso sim|qual|quais|especifique|descreva)\b/i;
const SECAO = /^(?:dados pessoais|termo)\b/i;
const DECLARACAO = /\bdeclaro\b|\bassinatura\b/i;

function normalizarLinha(l: string): string {
  return l.replace(/[\u00a0\t]/g, " ").replace(/\s+/g, " ").trim();
}

function semAcento(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/** Remove do fim os caracteres de `conjunto`, em tempo linear (regex com `+$` é quadrática). */
function cortarFim(s: string, conjunto: string): string {
  let fim = s.length;
  while (fim > 0 && (conjunto.includes(s[fim - 1]) || /\s/.test(s[fim - 1]))) fim--;
  return s.slice(0, fim);
}

/** Sem o campo de preencher no fim (sublinhados, pontilhados, barras de data). */
function semCampoFinal(s: string): string {
  return cortarFim(s, "_.…/");
}

function limparTexto(t: string): string {
  const limpo = t
    .replace(/\(?\s*\bdd\s*\/\s*mm\s*\/\s*a{2,4}\b\s*\)?/gi, " ")
    .replace(/_+/g, "_")
    .replace(/_(?:\s*\/\s*_)+/g, " ")
    .replace(/_/g, " ")
    .replace(/\.{3,}|…+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cortarFim(limpo, ":-–—").trim();
}

function limparOpcao(o: string): string {
  return cortarFim(limparTexto(o), ",;:");
}

function capitalizar(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

function unicas(lista: string[]): string[] {
  const vistas = new Set<string>();
  return lista.filter((o) => {
    const k = semAcento(o).toLowerCase();
    if (!o || vistas.has(k)) return false;
    vistas.add(k);
    return true;
  });
}

type LinhaAnalisada = {
  enunciado: string;
  opcoes: string[];
  temMarcadores: boolean;
  sn: boolean;
  data: boolean;
};

function analisarLinha(l: string): LinhaAnalisada {
  const data = CAMPO_DATA.test(l);
  let sn = false;
  let base = l;
  if (S_N.test(base)) {
    sn = true;
    base = base.replace(S_N, "").trim();
  }
  if (!TEM_MARCADOR.test(base)) {
    return { enunciado: base, opcoes: [], temMarcadores: false, sn, data };
  }
  const partes = base.split(MARCADOR);
  const ultima = limparTexto(partes[partes.length - 1]);
  let enunciado: string;
  let rotulos: string[];
  if (ultima === "" && partes.length >= 3) {
    // "Sim ( ) Não ( )": o rótulo vem antes do marcador.
    const primeira = partes[0];
    const corte = Math.max(primeira.lastIndexOf("?"), primeira.lastIndexOf(":"));
    if (corte >= 0) {
      enunciado = primeira.slice(0, corte + 1);
      rotulos = [primeira.slice(corte + 1), ...partes.slice(1, -1)];
    } else {
      const aparada = primeira.trimEnd();
      const m = /(?:^|[^\p{L}])(sim|n[aã]o)$/iu.exec(aparada);
      const antes = m ? aparada.slice(0, aparada.length - m[1].length) : "";
      if (m && antes.trim()) {
        enunciado = antes;
        rotulos = [m[1], ...partes.slice(1, -1)];
      } else {
        enunciado = "";
        rotulos = partes.slice(0, -1);
      }
    }
  } else {
    enunciado = partes[0];
    rotulos = partes.slice(1);
  }
  return {
    enunciado: enunciado.trim(),
    opcoes: rotulos.map(limparOpcao).filter(Boolean),
    temMarcadores: true,
    sn,
    data,
  };
}

/** Sim/não puro (cada opção é "Sim"/"Não", talvez seguida de "qual?"); devolve o detalhe extra. */
function analisarSimNao(opcoes: string[]): { simNao: boolean; extras: string[] } {
  if (opcoes.length < 2) return { simNao: false, extras: [] };
  const extras: string[] = [];
  let sim = false;
  let nao = false;
  for (const o of opcoes) {
    const m = /^(sim|n[aã]o)(?!\p{L})[\s,.;:\-–]*(.*)$/iu.exec(o);
    if (!m) return { simNao: false, extras: [] };
    if (/^sim$/i.test(m[1])) sim = true;
    else nao = true;
    const resto = m[2].trim();
    if (resto) {
      if (!DETALHE.test(resto)) return { simNao: false, extras: [] };
      extras.push(capitalizar(resto));
    }
  }
  return { simNao: sim && nao, extras: sim && nao ? extras : [] };
}

function ehTituloEmCaixaAlta(l: string): boolean {
  const letras = l.replace(/[^\p{L}]/gu, "");
  return letras.length >= 3 && letras === letras.toUpperCase() && letras !== letras.toLowerCase();
}

type Bloco = {
  tipo: "pergunta" | "titulo" | "declaracao" | "solta";
  partes: string[];
  opcoes: string[];
  sn: boolean;
  data: boolean;
  aberta: boolean;
};

function terminaFechada(enunciado: string): boolean {
  const s = semCampoFinal(enunciado);
  return s.endsWith("?") || s.endsWith(":");
}

/** Vários campos "Rótulo: ____" na mesma linha viram linhas separadas (sem regex preguiçosa). */
function separarCampos(l: string): string[] {
  if (!l.includes("___") && !l.includes("...")) return [l];
  const partes = l.split(":");
  const campos: string[] = [];
  let rotulo = partes[0];
  for (const trecho of partes.slice(1)) {
    // [_./] e \s são disjuntos: casa em tempo linear.
    const campo = /^\s*(?:[_./]\s*)*/.exec(trecho)?.[0] ?? "";
    if (campo.replace(/\s/g, "").length >= 3) {
      campos.push(`${rotulo}: ${campo.trim()}`);
      rotulo = trecho.slice(campo.length);
    } else {
      rotulo += `:${trecho}`;
    }
  }
  if (campos.length < 2) return [l];
  return [...campos, rotulo].map((s) => s.trim()).filter(Boolean);
}

function preprocessar(texto: string): string[] {
  const linhas = texto
    .split(/\r?\n|\r/)
    .map((l) => normalizarLinha(l.slice(0, MAX_CARACTERES_LINHA * 2)).slice(0, MAX_CARACTERES_LINHA))
    .filter((l) => l && !SO_TRACOS.test(l) && !PAGINA.test(l))
    .flatMap(separarCampos);
  const contagem = new Map<string, number>();
  for (const l of linhas) contagem.set(l, (contagem.get(l) ?? 0) + 1);
  const protegida = (l: string) => TEM_MARCADOR.test(l) || S_N.test(l) || l.includes("?");
  return linhas.filter((l) => protegida(l) || (contagem.get(l) ?? 0) < 3);
}

function finalizar(b: Bloco): PerguntaImportada | null {
  let texto = limparTexto(b.partes.join(" "));
  const opcoes = unicas(b.opcoes);
  const sn = analisarSimNao(opcoes);
  if (sn.simNao && sn.extras.length) texto = limparTexto([texto, ...sn.extras].join(" "));
  if (!texto) return null;
  const simNao = b.sn || sn.simNao;
  let tipo: TipoPergunta = "texto";
  if (simNao) tipo = DETALHE.test(texto) ? "sim_nao_detalhe" : "sim_nao";
  else if (opcoes.length >= 2) tipo = "multipla";
  else if (b.data || /\bdata\b/i.test(texto)) tipo = "data";
  return {
    texto,
    tipo,
    ...(tipo === "multipla" ? { opcoes } : {}),
    incluir: b.tipo === "pergunta",
    obrigatoria: false,
  };
}

export function extrairPerguntas(texto: string): PerguntaImportada[] {
  const blocos: Bloco[] = [];
  const ultimo = () => blocos[blocos.length - 1] as Bloco | undefined;
  const novo = (tipo: Bloco["tipo"], a: LinhaAnalisada, aberta: boolean) => {
    blocos.push({
      tipo,
      partes: [a.enunciado.replace(NUMERACAO, "")],
      opcoes: a.opcoes,
      sn: a.sn,
      data: a.data,
      aberta,
    });
  };

  for (const l of preprocessar(limitarTexto(texto).texto)) {
    const a = analisarLinha(l);
    const anterior = ultimo();
    const numerada = NUMERACAO.test(a.enunciado);

    // Linha só de opções: vai para a pergunta anterior.
    if (!a.enunciado && (a.temMarcadores || a.sn)) {
      if (anterior?.tipo === "pergunta") {
        anterior.opcoes.push(...a.opcoes);
        anterior.sn ||= a.sn;
        anterior.aberta = false;
      }
      continue;
    }

    // "Se sim, qual? ____" logo depois de uma pergunta de sim/não.
    if (
      anterior?.tipo === "pergunta" &&
      !numerada &&
      !a.temMarcadores &&
      INICIO_DETALHE.test(a.enunciado) &&
      (anterior.sn || analisarSimNao(unicas(anterior.opcoes)).simNao)
    ) {
      anterior.partes.push(a.enunciado);
      continue;
    }

    const fechada = terminaFechada(a.enunciado);
    const ehPergunta =
      fechada || numerada || a.temMarcadores || a.sn;

    if (DECLARACAO.test(a.enunciado)) {
      novo("declaracao", a, !fechada);
      continue;
    }
    if (SECAO.test(a.enunciado) || (!fechada && !a.temMarcadores && ehTituloEmCaixaAlta(a.enunciado))) {
      novo("titulo", a, false);
      continue;
    }

    const minuscula = /^\p{Ll}/u.test(a.enunciado);
    if (anterior?.aberta && (!ehPergunta || (minuscula && !numerada))) {
      anterior.partes.push(a.enunciado);
      anterior.opcoes.push(...a.opcoes);
      anterior.sn ||= a.sn;
      anterior.data ||= a.data;
      anterior.aberta = !fechada && !a.temMarcadores && !a.sn;
      continue;
    }

    if (ehPergunta) novo("pergunta", a, !fechada && !a.temMarcadores && !a.sn);
    else novo("solta", a, true);
  }

  return blocos.map(finalizar).filter((p): p is PerguntaImportada => p !== null);
}

export function juntarComProxima(itens: PerguntaImportada[], i: number): PerguntaImportada[] {
  if (i < 0 || i >= itens.length - 1) return itens;
  const [a, b] = [itens[i], itens[i + 1]];
  const opcoes = unicas([...(a.opcoes ?? []), ...(b.opcoes ?? [])]);
  const junto: PerguntaImportada = {
    texto: [a.texto.trim(), b.texto.trim()].filter(Boolean).join(" "),
    tipo: a.tipo === "texto" ? b.tipo : a.tipo,
    ...(opcoes.length ? { opcoes } : {}),
    incluir: a.incluir || b.incluir,
    ...(a.obrigatoria !== undefined || b.obrigatoria !== undefined
      ? { obrigatoria: !!a.obrigatoria || !!b.obrigatoria }
      : {}),
  };
  return [...itens.slice(0, i), junto, ...itens.slice(i + 2)];
}

/** Divide no cursor; sem cursor útil, na primeira quebra de linha ou no primeiro "?". */
export function separarPergunta(
  itens: PerguntaImportada[],
  i: number,
  posicao?: number,
): PerguntaImportada[] {
  const item = itens[i];
  if (!item) return itens;
  const t = item.texto;
  let corte = -1;
  let pula = 0;
  if (posicao !== undefined && posicao > 0 && posicao < t.trimEnd().length) corte = posicao;
  else if (t.includes("\n")) {
    corte = t.indexOf("\n");
    pula = 1;
  } else {
    const q = t.indexOf("?");
    if (q >= 0 && q < t.trimEnd().length - 1) corte = q + 1;
  }
  if (corte < 0) return itens;
  const [antes, depois] = [t.slice(0, corte).trim(), t.slice(corte + pula).trim()];
  if (!antes || !depois) return itens;
  const segundo: PerguntaImportada = {
    texto: depois,
    tipo: "texto",
    incluir: item.incluir,
    ...(item.obrigatoria !== undefined ? { obrigatoria: false } : {}),
  };
  return [...itens.slice(0, i), { ...item, texto: antes }, segundo, ...itens.slice(i + 1)];
}

/** Perguntas incluídas no formato do modelo; ids novos que não colidem com `idsExistentes`. */
export function perguntasDaImportacao(
  itens: PerguntaImportada[],
  idsExistentes: string[],
): Pergunta[] {
  const usados = [...idsExistentes];
  const saida: Pergunta[] = [];
  for (const item of itens) {
    const texto = item.texto.replace(/\s+/g, " ").trim();
    if (!item.incluir || !texto) continue;
    const opcoes = unicas((item.opcoes ?? []).map((o) => o.trim()).filter(Boolean));
    const tipo: TipoPergunta = item.tipo === "multipla" && opcoes.length < 2 ? "texto" : item.tipo;
    const id = gerarIdPergunta(texto, usados);
    usados.push(id);
    saida.push({
      id,
      tipo,
      texto,
      obrigatoria: !!item.obrigatoria,
      alerta: false,
      ...(tipo === "multipla" ? { opcoes } : {}),
    });
  }
  return saida;
}

export type ItemTextoPdf = { str: string; x: number; y: number };

/** Monta linhas a partir dos itens de texto do PDF: mesma altura (y) = mesma linha. */
export function textoDosItensPdf(paginas: ItemTextoPdf[][], tolerancia = 2.5): string {
  const linhas: string[] = [];
  for (const itens of paginas) {
    const ordenados = itens
      .filter((it) => it.str.trim())
      .sort((a, b) => b.y - a.y || a.x - b.x);
    let grupo: ItemTextoPdf[] = [];
    const fechar = () => {
      if (!grupo.length) return;
      linhas.push(
        normalizarLinha(
          grupo
            .sort((a, b) => a.x - b.x)
            .map((it) => it.str)
            .join(" "),
        ),
      );
      grupo = [];
    };
    for (const it of ordenados) {
      if (grupo.length && Math.abs(grupo[0].y - it.y) > tolerancia) fechar();
      grupo.push(it);
    }
    fechar();
  }
  return linhas.join("\n");
}

export function caracteresUteis(texto: string): number {
  return (texto.match(/[\p{L}\p{N}]/gu) ?? []).length;
}
