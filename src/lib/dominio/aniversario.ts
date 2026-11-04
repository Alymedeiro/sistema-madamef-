// Aniversariantes de um período de datas (yyyy-MM-dd), comparando só mês/dia.

const DATA = /^(\d{4})-(\d{2})-(\d{2})$/;

function bissexto(ano: number): boolean {
  return (ano % 4 === 0 && ano % 100 !== 0) || ano % 400 === 0;
}

/** Chaves "MM-dd" que fazem aniversário em cada dia do período (29/02 conta em 28/02 em ano comum). */
function chavesDoPeriodo(de: string, ate: string): Set<string> {
  const a = DATA.exec(de);
  const b = DATA.exec(ate);
  if (!a || !b) throw new RangeError(`Período inválido: ${de} a ${ate}`);

  const chaves = new Set<string>();
  const fim = Date.UTC(Number(b[1]), Number(b[2]) - 1, Number(b[3]));
  for (let t = Date.UTC(Number(a[1]), Number(a[2]) - 1, Number(a[3])); t <= fim; t += 86_400_000) {
    const dia = new Date(t);
    const chave = dia.toISOString().slice(5, 10);
    chaves.add(chave);
    if (chave === "02-28" && !bissexto(dia.getUTCFullYear())) chaves.add("02-29");
  }
  return chaves;
}

export function aniversariantes<T extends { dataNascimento: string | null }>(
  clientes: T[],
  de: string,
  ate: string,
): T[] {
  const chaves = chavesDoPeriodo(de, ate);
  return clientes.filter(
    (c) => c.dataNascimento !== null && chaves.has(c.dataNascimento.slice(5, 10)),
  );
}
