/** Destino de retorno vindo da URL: só caminho interno; qualquer outra coisa cai no padrão. */
export function destinoInterno(v: string | undefined, padrao: string): string {
  if (!v || !v.startsWith("/") || v.startsWith("//")) return padrao;
  // Barra invertida e caracteres de controle (tab, quebra de linha) são removidos ou
  // reinterpretados pelo navegador e podem virar "//host".
  if (v.includes("\\") || /[\u0000-\u001f\u007f]/.test(v)) return padrao;
  try {
    const u = new URL(v, "http://interno.invalido");
    if (u.origin !== "http://interno.invalido") return padrao;
  } catch {
    return padrao;
  }
  return v;
}
