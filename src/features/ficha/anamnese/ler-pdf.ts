// Extrai o texto de um PDF no próprio navegador: o arquivo nunca é enviado ao servidor.

import { textoDosItensPdf, type ItemTextoPdf } from "@/lib/dominio/anamnese-importar";

export async function textoDoPdf(arquivo: File): Promise<string> {
  // Carregado só ao clicar; o build "legacy" cobre Safari/iOS mais antigos.
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/legacy/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();

  const dados = new Uint8Array(await arquivo.arrayBuffer());
  const tarefa = pdfjs.getDocument({ data: dados, verbosity: pdfjs.VerbosityLevel.ERRORS });
  try {
    const doc = await tarefa.promise;
    const paginas: ItemTextoPdf[][] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const pagina = await doc.getPage(n);
      const conteudo = await pagina.getTextContent();
      paginas.push(
        conteudo.items.flatMap((it) =>
          "str" in it ? [{ str: it.str, x: it.transform[4], y: it.transform[5] }] : [],
        ),
      );
      pagina.cleanup();
    }
    return textoDosItensPdf(paginas);
  } finally {
    await tarefa.destroy();
  }
}
