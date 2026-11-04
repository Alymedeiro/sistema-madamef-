import "server-only";
import { createHash } from "node:crypto";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { formatarCPF } from "@/lib/dominio/cpf";
import { formatarNoFuso } from "@/lib/dominio/tempo";
import { blocosMarkdown } from "@/lib/dominio/termos";

export type DadosTermoPdf = {
  identificador: string;
  titulo: string;
  versao: number;
  texto: string;
  clienteNome: string;
  clienteCpf: string | null;
  assinadoEm: Date;
  dispositivo: string;
  assinaturaPng: Uint8Array;
};

// Caracteres de 0x80–0x9F que o WinAnsi (cp1252) tem e o Unicode põe em outro lugar.
const WINANSI_EXTRA = new Set(
  "€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ".split(""),
);

/** Troca por `?` o que as fontes padrão do pdf-lib (WinAnsi) não desenham. */
export function textoSeguroWinAnsi(t: string): string {
  let saida = "";
  for (const c of t) {
    const cp = c.codePointAt(0)!;
    if (c === "\t") saida += " ";
    else if ((cp >= 0x20 && cp <= 0x7e) || (cp >= 0xa0 && cp <= 0xff) || WINANSI_EXTRA.has(c))
      saida += c;
    else saida += "?";
  }
  return saida;
}

export function rodapeDoTermo(d: Omit<DadosTermoPdf, "assinaturaPng">): string[] {
  const cpf = d.clienteCpf ? ` — CPF ${formatarCPF(d.clienteCpf)}` : "";
  return [
    `Cliente: ${d.clienteNome}${cpf}`,
    `Assinado em ${formatarNoFuso(d.assinadoEm, "dd/MM/yyyy")} às ${formatarNoFuso(d.assinadoEm, "HH:mm")} (horário de Brasília)`,
    `Dispositivo: ${d.dispositivo}`,
    `Identificador: ${d.identificador}`,
    `Termo: ${d.titulo} — versão ${d.versao}`,
  ];
}

const A4 = { largura: 595.28, altura: 841.89 };
const MARGEM = 50;
const LARGURA_UTIL = A4.largura - 2 * MARGEM;
const LARGURA_MAX_ASSINATURA = 240;
const ALTURA_MAX_ASSINATURA = 110;
const COR = rgb(0.1, 0.1, 0.1);

/** Quebra em linhas que cabem em `largura`; palavra maior que a linha é partida por caractere. */
function quebrar(texto: string, fonte: PDFFont, tamanho: number, largura: number): string[] {
  const mede = (t: string) => fonte.widthOfTextAtSize(t, tamanho);
  const linhas: string[] = [];
  let atual = "";
  for (const palavra of texto.split(/\s+/).filter(Boolean)) {
    const tentativa = atual ? `${atual} ${palavra}` : palavra;
    if (mede(tentativa) <= largura) {
      atual = tentativa;
      continue;
    }
    if (atual) linhas.push(atual);
    atual = "";
    let resto = palavra;
    while (mede(resto) > largura) {
      let n = resto.length - 1;
      while (n > 1 && mede(resto.slice(0, n)) > largura) n--;
      linhas.push(resto.slice(0, n));
      resto = resto.slice(n);
    }
    atual = resto;
  }
  if (atual) linhas.push(atual);
  return linhas;
}

export async function gerarPdfTermo(
  d: DadosTermoPdf,
): Promise<{ pdf: Uint8Array; hashSha256: string }> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  const normal = await doc.embedFont(StandardFonts.Helvetica);
  const negrito = await doc.embedFont(StandardFonts.HelveticaBold);

  let pagina: PDFPage = doc.addPage([A4.largura, A4.altura]);
  let y = A4.altura - MARGEM;

  const garantir = (altura: number) => {
    if (y - altura < MARGEM) {
      pagina = doc.addPage([A4.largura, A4.altura]);
      y = A4.altura - MARGEM;
    }
  };
  const escrever = (
    texto: string,
    o: { fonte?: PDFFont; tamanho?: number; recuo?: number; depois?: number } = {},
  ) => {
    const fonte = o.fonte ?? normal;
    const tamanho = o.tamanho ?? 11;
    const recuo = o.recuo ?? 0;
    const linhaAltura = tamanho * 1.4;
    for (const linha of quebrar(textoSeguroWinAnsi(texto), fonte, tamanho, LARGURA_UTIL - recuo)) {
      garantir(linhaAltura);
      y -= linhaAltura;
      pagina.drawText(linha, { x: MARGEM + recuo, y: y + tamanho * 0.3, size: tamanho, font: fonte, color: COR });
    }
    y -= o.depois ?? 0;
  };

  escrever(d.titulo, { fonte: negrito, tamanho: 18, depois: 10 });
  for (const b of blocosMarkdown(d.texto)) {
    if (b.tipo === "titulo") escrever(b.texto, { fonte: negrito, tamanho: 13, depois: 4 });
    else if (b.tipo === "item") escrever(`• ${b.texto}`, { recuo: 14, depois: 2 });
    else escrever(b.texto, { depois: 8 });
  }

  y -= 6;
  escrever("Li e concordo com os termos acima.", { fonte: negrito, depois: 10 });

  const imagem = await doc.embedPng(d.assinaturaPng);
  const escala = Math.min(
    LARGURA_MAX_ASSINATURA / imagem.width,
    ALTURA_MAX_ASSINATURA / imagem.height,
    1,
  );
  const w = imagem.width * escala;
  const h = imagem.height * escala;
  const rodape = rodapeDoTermo(d);
  garantir(h + 12 + rodape.length * 13 + 12);
  pagina.drawImage(imagem, { x: MARGEM, y: y - h, width: w, height: h });
  y -= h + 4;
  pagina.drawLine({
    start: { x: MARGEM, y },
    end: { x: MARGEM + Math.max(w, LARGURA_MAX_ASSINATURA), y },
    thickness: 0.5,
    color: COR,
  });
  y -= 14;
  for (const linha of rodape) escrever(linha, { tamanho: 9 });

  doc.setTitle(`${d.titulo} — v${d.versao}`);
  doc.setSubject(d.identificador);
  doc.setProducer("Madame Fê Clinic");
  doc.setCreator("Madame Fê Clinic");
  doc.setCreationDate(d.assinadoEm);
  doc.setModificationDate(d.assinadoEm);

  const pdf = await doc.save();
  return { pdf, hashSha256: createHash("sha256").update(pdf).digest("hex") };
}
