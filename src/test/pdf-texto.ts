import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream, decodePDFRawStream } from "pdf-lib";

/** Texto desenhado (operadores Tj, em hex) e contagem de imagens, lidos do próprio PDF (como em pdf-termo.test). */
export async function conteudoDoPdf(pdf: Uint8Array) {
  const doc = await PDFDocument.load(pdf);
  const paginas: string[] = [];
  let imagens = 0;
  for (const pagina of doc.getPages()) {
    let texto = "";
    const res = pagina.node.Resources() as PDFDict;
    const xo = res.lookupMaybe(PDFName.of("XObject"), PDFDict);
    for (const [, ref] of xo?.entries() ?? []) {
      const o = doc.context.lookup(ref) as PDFRawStream;
      if (o.dict.get(PDFName.of("Subtype")) === PDFName.of("Image")) imagens++;
    }
    const cont = pagina.node.Contents();
    const fluxos = cont instanceof PDFArray ? cont.asArray().map((r) => doc.context.lookup(r)) : [cont];
    for (const f of fluxos) {
      const bytes = decodePDFRawStream(f as PDFRawStream).decode();
      const bruto = Buffer.from(bytes).toString("latin1");
      for (const m of bruto.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)) {
        texto += Buffer.from(m[1], "hex").toString("latin1") + "\n";
      }
    }
    paginas.push(texto);
  }
  return { paginas, texto: paginas.join(""), imagens };
}
