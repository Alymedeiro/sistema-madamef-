import "server-only";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import type { Resumo } from "@/app/(app)/financeiro/dados";
import { formatarBRL } from "@/lib/dominio/dinheiro";
import { comVencidos, saldos } from "@/lib/dominio/financeiro";
import { ROTULO_ABA_FINANCEIRO } from "@/lib/dominio/permissoes";
import { formatarNoFuso } from "@/lib/dominio/tempo";
import { textoSeguroWinAnsi } from "@/lib/ficha/pdf-termo";

export type AbaRelatorio = "painel" | "receber" | "pagar" | "fluxo" | "comissoes";

export type DadosRelatorioPdf = {
  aba: AbaRelatorio;
  periodoRotulo: string;
  filtros: string[];
  geradoPor: string;
  geradoEm: Date;
  /** Os 7 cartões (só no Painel). */
  cartoes?: Resumo;
  colunas: string[];
  linhas: string[][];
  totais: [string, string][];
};

const A4 = { largura: 595.28, altura: 841.89 };
const MARGEM = 40;
const RODAPE = 34;
const LARGURA_UTIL = A4.largura - 2 * MARGEM;
const LOGO = 46;
const TAM_TABELA = 8.5;
const ALTURA_LINHA = 15;
const PAD = 4;
const COR = rgb(0.1, 0.1, 0.1);
const COR_SUAVE = rgb(0.4, 0.4, 0.4);
const OURO_ESCURO = rgb(0.55, 0.42, 0.2);
const FUNDO_CABECALHO = rgb(0.93, 0.88, 0.78);
const FUNDO_ZEBRA = rgb(0.97, 0.96, 0.94);
const VERMELHO = rgb(0.7, 0.12, 0.12);

let logoEmCache: Promise<Uint8Array | null> | null = null;

/** Logo da clínica lido do disco uma vez; sem o arquivo, o PDF sai sem logo. */
function lerLogo(): Promise<Uint8Array | null> {
  logoEmCache ??= readFile(join(process.cwd(), "public", "brand", "logo-madame-fe.png"))
    .then((b) => new Uint8Array(b))
    .catch(() => null);
  return logoEmCache;
}

/** Corta o texto com "…" para caber em `largura`. */
function caber(texto: string, fonte: PDFFont, tamanho: number, largura: number): string {
  if (fonte.widthOfTextAtSize(texto, tamanho) <= largura) return texto;
  let n = texto.length;
  while (n > 0 && fonte.widthOfTextAtSize(`${texto.slice(0, n)}…`, tamanho) > largura) n--;
  return n > 0 ? `${texto.slice(0, n)}…` : "";
}

const ehValor = (s: string) => /^-?R\$/.test(s);

/**
 * Larguras das colunas: a natural (maior texto + folga); se não couber, colunas
 * curtas (datas, valores) mantêm a natural e as demais dividem o resto.
 */
function larguras(colunas: string[], linhas: string[][], normal: PDFFont, negrito: PDFFont): number[] {
  const natural = colunas.map((c, i) => {
    let w = negrito.widthOfTextAtSize(c, TAM_TABELA);
    for (const l of linhas) w = Math.max(w, normal.widthOfTextAtSize(l[i] ?? "", TAM_TABELA));
    return w + 2 * PAD;
  });
  const soma = natural.reduce((s, w) => s + w, 0);
  if (soma <= LARGURA_UTIL) return natural.map((w) => (w / soma) * LARGURA_UTIL);
  const CURTA = 90;
  const fixas = natural.reduce((s, w) => s + (w <= CURTA ? w : 0), 0);
  const flexiveis = soma - fixas;
  const resto = LARGURA_UTIL - fixas;
  if (flexiveis === 0 || resto < 60) return natural.map((w) => (w / soma) * LARGURA_UTIL);
  return natural.map((w) => (w <= CURTA ? w : (w / flexiveis) * resto));
}

function linhasDosCartoes(r: Resumo): [string, string, string, boolean][] {
  const { saldoCaixa, saldoProjetado } = saldos(r);
  const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;
  const brl = (c: number) => (c < 0 ? `-${formatarBRL(-c)}` : formatarBRL(c));
  return [
    ["Recebido", brl(r.recebido), plural(r.recebidoQtd, "recebimento confirmado", "recebimentos confirmados"), false],
    ["Pago", brl(r.pago), plural(r.pagoQtd, "pagamento confirmado", "pagamentos confirmados"), false],
    ["Saldo em caixa", brl(saldoCaixa), saldoCaixa >= 0 ? "No azul" : "No vermelho", saldoCaixa < 0],
    ["A receber", brl(r.aReceber), comVencidos(`já recebido: ${brl(r.jaRecebido)}`, r.aReceberVencido, brl), false],
    ["A pagar", brl(r.aPagar), comVencidos(`já pago: ${brl(r.jaPago)}`, r.aPagarVencido, brl), false],
    ["Saldo projetado", brl(saldoProjetado), "Saldo em caixa + A receber - A pagar", saldoProjetado < 0],
    ["Vencidos", brl(r.vencidosTotal), plural(r.vencidosQtd, "conta em aberto", "contas em aberto"), true],
  ];
}

/**
 * Relatório da aba do Financeiro: A4 retrato, cabeçalho (logo, clínica, aba,
 * período, filtros, quem gerou), cartões no Painel, tabela com quebra de
 * página e cabeçalho repetido, totais e rodapé "Página N de M".
 */
export async function gerarPdfRelatorio(dados: DadosRelatorioPdf): Promise<Uint8Array> {
  const s = textoSeguroWinAnsi;
  // Tudo que vai ser medido ou desenhado passa antes pelo filtro WinAnsi.
  const d = { ...dados, colunas: dados.colunas.map(s), linhas: dados.linhas.map((l) => l.map(s)) };
  const doc = await PDFDocument.create({ updateMetadata: false });
  const normal = await doc.embedFont(StandardFonts.Helvetica);
  const negrito = await doc.embedFont(StandardFonts.HelveticaBold);
  const bytesLogo = await lerLogo();
  const logo: PDFImage | null = bytesLogo ? await doc.embedPng(bytesLogo) : null;
  const titulo = ROTULO_ABA_FINANCEIRO[d.aba];

  let pagina: PDFPage = doc.addPage([A4.largura, A4.altura]);
  let y = A4.altura - MARGEM;

  const texto = (
    t: string,
    x: number,
    o: { fonte?: PDFFont; tamanho?: number; cor?: ReturnType<typeof rgb>; largura?: number; direita?: boolean } = {},
  ) => {
    const fonte = o.fonte ?? normal;
    const tamanho = o.tamanho ?? 10;
    const conteudo = o.largura ? caber(s(t), fonte, tamanho, o.largura) : s(t);
    const dx = o.direita && o.largura ? o.largura - fonte.widthOfTextAtSize(conteudo, tamanho) : 0;
    pagina.drawText(conteudo, { x: x + dx, y, size: tamanho, font: fonte, color: o.cor ?? COR });
  };
  const novaPagina = () => {
    pagina = doc.addPage([A4.largura, A4.altura]);
    y = A4.altura - MARGEM;
  };
  const garantir = (altura: number) => {
    if (y - altura < MARGEM + RODAPE) {
      novaPagina();
      return true;
    }
    return false;
  };

  // Cabeçalho do relatório.
  const xTexto = logo ? MARGEM + LOGO + 12 : MARGEM;
  if (logo) {
    const escala = Math.min(LOGO / logo.width, LOGO / logo.height);
    pagina.drawImage(logo, {
      x: MARGEM,
      y: y - LOGO,
      width: logo.width * escala,
      height: logo.height * escala,
    });
  }
  y -= 16;
  texto("Madame Fê Clinic", xTexto, { fonte: negrito, tamanho: 16, cor: OURO_ESCURO });
  y -= 18;
  texto(`Relatório financeiro — ${titulo}`, xTexto, { fonte: negrito, tamanho: 13 });
  y -= 15;
  texto(`Período: ${d.periodoRotulo}`, xTexto, { largura: LARGURA_UTIL - (xTexto - MARGEM) });
  y = Math.min(y, A4.altura - MARGEM - LOGO) - 6;
  for (const f of d.filtros) {
    y -= 13;
    texto(f, MARGEM, { tamanho: 9.5, largura: LARGURA_UTIL });
  }
  y -= 13;
  texto(
    `Gerado em ${formatarNoFuso(d.geradoEm, "dd/MM/yyyy HH:mm")} por ${d.geradoPor}`,
    MARGEM,
    { tamanho: 9, cor: COR_SUAVE, largura: LARGURA_UTIL },
  );
  y -= 10;
  pagina.drawLine({
    start: { x: MARGEM, y },
    end: { x: A4.largura - MARGEM, y },
    thickness: 0.6,
    color: OURO_ESCURO,
  });
  y -= 8;

  // Cartões do Painel.
  if (d.cartoes) {
    y -= 12;
    texto("Resumo do período", MARGEM, { fonte: negrito, tamanho: 11, cor: OURO_ESCURO });
    y -= 4;
    for (const [rotulo, valor, detalhe, alerta] of linhasDosCartoes(d.cartoes)) {
      y -= 15;
      texto(rotulo, MARGEM, { fonte: negrito, tamanho: 10 });
      texto(valor, MARGEM + 110, { fonte: negrito, tamanho: 10, largura: 100, direita: true, cor: alerta ? VERMELHO : COR });
      texto(detalhe, MARGEM + 225, { tamanho: 9, cor: COR_SUAVE, largura: LARGURA_UTIL - 225 });
    }
    y -= 10;
  }

  // Tabela.
  const ws = larguras(d.colunas, d.linhas, normal, negrito);
  const direita = d.colunas.map((_, i) => {
    const cheias = d.linhas.map((l) => l[i] ?? "").filter((c) => c && c !== "—");
    return cheias.length > 0 && cheias.every(ehValor);
  });
  const desenharCabecalhoTabela = () => {
    pagina.drawRectangle({
      x: MARGEM,
      y: y - ALTURA_LINHA,
      width: LARGURA_UTIL,
      height: ALTURA_LINHA,
      color: FUNDO_CABECALHO,
    });
    y -= ALTURA_LINHA - 4.5;
    let x = MARGEM;
    d.colunas.forEach((c, i) => {
      texto(c, x + PAD, { fonte: negrito, tamanho: TAM_TABELA, largura: ws[i] - 2 * PAD, direita: direita[i] });
      x += ws[i];
    });
    y -= 4.5;
  };

  y -= 6;
  garantir(ALTURA_LINHA * 2);
  desenharCabecalhoTabela();
  if (d.linhas.length === 0) {
    y -= ALTURA_LINHA;
    texto("Nada a listar com estes filtros.", MARGEM + PAD, { tamanho: 9, cor: COR_SUAVE });
  }
  d.linhas.forEach((linha, n) => {
    if (garantir(ALTURA_LINHA)) desenharCabecalhoTabela();
    if (n % 2 === 1) {
      pagina.drawRectangle({ x: MARGEM, y: y - ALTURA_LINHA, width: LARGURA_UTIL, height: ALTURA_LINHA, color: FUNDO_ZEBRA });
    }
    y -= ALTURA_LINHA - 4.5;
    let x = MARGEM;
    d.colunas.forEach((_, i) => {
      texto(linha[i] ?? "", x + PAD, { tamanho: TAM_TABELA, largura: ws[i] - 2 * PAD, direita: direita[i] });
      x += ws[i];
    });
    y -= 4.5;
  });

  // Totais.
  if (d.totais.length > 0) {
    y -= 10;
    garantir(14 + d.totais.length * 14);
    y -= 12;
    texto("Totais", MARGEM, { fonte: negrito, tamanho: 11, cor: OURO_ESCURO });
    for (const [rotulo, valor] of d.totais) {
      if (garantir(14)) y -= 2;
      y -= 14;
      texto(rotulo, MARGEM, { tamanho: 10, largura: 300 });
      texto(valor, A4.largura - MARGEM - 160, { fonte: negrito, tamanho: 10, largura: 160, direita: true });
    }
  }

  // Rodapé em todas as páginas.
  const paginas = doc.getPages();
  paginas.forEach((p, i) => {
    const rodape = `Página ${i + 1} de ${paginas.length}`;
    const w = normal.widthOfTextAtSize(rodape, 8);
    p.drawText(s(`Madame Fê Clinic — ${titulo}`), { x: MARGEM, y: 22, size: 8, font: normal, color: COR_SUAVE });
    p.drawText(rodape, { x: A4.largura - MARGEM - w, y: 22, size: 8, font: normal, color: COR_SUAVE });
  });

  doc.setTitle(s(`Financeiro — ${titulo} — ${d.periodoRotulo}`));
  doc.setAuthor(s(d.geradoPor));
  doc.setProducer("Madame Fê Clinic");
  doc.setCreator("Madame Fê Clinic");
  doc.setCreationDate(d.geradoEm);
  doc.setModificationDate(d.geradoEm);
  return doc.save();
}
