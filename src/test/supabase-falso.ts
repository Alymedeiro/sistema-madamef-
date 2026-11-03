// Cliente Supabase falso para testar Server Actions sem backend: registra cada
// chamada encadeada e responde com o que o teste enfileirou por tabela.

export type Resposta = { data: unknown; error: { code?: string; message?: string } | null };
export type Chamada = { tabela: string; metodo: string; args: unknown[] };

const METODOS = [
  "select",
  "insert",
  "update",
  "upsert",
  "delete",
  "eq",
  "in",
  "like",
  "ilike",
  "or",
  "order",
  "limit",
  "maybeSingle",
  "single",
];

export function criarSupabaseFalso() {
  const chamadas: Chamada[] = [];
  const filas = new Map<string, Resposta[]>();
  let padrao: Resposta = { data: [{ id: "00000000-0000-4000-8000-000000000001" }], error: null };

  function proxima(tabela: string): Resposta {
    return filas.get(tabela)?.shift() ?? padrao;
  }

  function consulta(tabela: string) {
    // Cada `await` da cadeia consome uma resposta da fila da tabela.
    const c: Record<string, unknown> = {
      then: (resolve: (r: Resposta) => unknown, reject: (e: unknown) => unknown) =>
        Promise.resolve(proxima(tabela)).then(resolve, reject),
    };
    for (const metodo of METODOS) {
      c[metodo] = (...args: unknown[]) => {
        chamadas.push({ tabela, metodo, args });
        return c;
      };
    }
    return c;
  }

  return {
    cliente: { from: (tabela: string) => consulta(tabela) },
    chamadas,
    /** Enfileira respostas, na ordem em que as consultas da tabela serão aguardadas. */
    responder(tabela: string, ...respostas: Resposta[]) {
      filas.set(tabela, [...(filas.get(tabela) ?? []), ...respostas]);
    },
    definirPadrao(resposta: Resposta) {
      padrao = resposta;
    },
    chamadasDe(tabela: string, metodo?: string) {
      return chamadas.filter((c) => c.tabela === tabela && (!metodo || c.metodo === metodo));
    },
  };
}
