// Termos de consentimento: texto em markdown simples e resumo do dispositivo
// (puro, sem I/O).

export type BlocoTexto = { tipo: "titulo" | "paragrafo" | "item"; texto: string };

/**
 * Markdown simples: linha `# ` = título, `- ` = item, linhas seguidas = um
 * parágrafo, linha vazia separa. Qualquer outra marcação fica como texto.
 */
export function blocosMarkdown(texto: string): BlocoTexto[] {
  const blocos: BlocoTexto[] = [];
  let paragrafo: string[] = [];
  const fechar = () => {
    if (paragrafo.length > 0) blocos.push({ tipo: "paragrafo", texto: paragrafo.join(" ") });
    paragrafo = [];
  };
  for (const bruta of texto.split(/\r\n|\r|\n/)) {
    const linha = bruta.trim();
    if (linha === "") {
      fechar();
    } else if (linha.startsWith("# ")) {
      fechar();
      blocos.push({ tipo: "titulo", texto: linha.slice(2).trim() });
    } else if (linha.startsWith("- ")) {
      fechar();
      blocos.push({ tipo: "item", texto: linha.slice(2).trim() });
    } else {
      paragrafo.push(linha);
    }
  }
  fechar();
  return blocos;
}

/** "iPad · Safari", "Windows · Edge"…; desconhecido: os primeiros 60 caracteres. Sempre ≤ 200. */
export function resumirUserAgent(ua: string): string {
  const s = String(ua ?? "");
  const aparelho = /iPad/.test(s)
    ? "iPad"
    : /iPhone|iPod/.test(s)
      ? "iPhone"
      : /Android/.test(s)
        ? "Android"
        : /Windows/.test(s)
          ? "Windows"
          : /Macintosh|Mac OS X/.test(s)
            ? "Mac"
            : /Linux|X11/.test(s)
              ? "Linux"
              : null;
  // A ordem importa: Edge, Opera e Chrome também se anunciam como Safari.
  const navegador = /Edg(e|A|iOS)?\//.test(s)
    ? "Edge"
    : /OPR\/|Opera/.test(s)
      ? "Opera"
      : /Firefox\/|FxiOS\//.test(s)
        ? "Firefox"
        : /Chrome\/|CriOS\//.test(s)
          ? "Chrome"
          : /Safari\//.test(s)
            ? "Safari"
            : null;
  if (aparelho && navegador) return `${aparelho} · ${navegador}`;
  return s.slice(0, 60).trim();
}
