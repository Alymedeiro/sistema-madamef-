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
  "neq",
  "lt",
  "lte",
  "gt",
  "gte",
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
    cliente: {
      from: (tabela: string) => consulta(tabela),
      storage: {
        from: (bucket: string) => {
          const tabela = `storage:${bucket}`;
          const chamar = (metodo: string, args: unknown[], padraoResp: Resposta) => {
            chamadas.push({ tabela, metodo, args });
            return Promise.resolve(filas.get(`${tabela}:${metodo}`)?.shift() ?? padraoResp);
          };
          return {
            upload: (path: string, corpo: unknown, opcoes?: unknown) =>
              chamar("upload", [path, corpo, opcoes], { data: { path }, error: null }),
            remove: (paths: string[]) => chamar("remove", [paths], { data: [], error: null }),
            createSignedUrl: (path: string, segundos: number) =>
              chamar("createSignedUrl", [path, segundos], {
                data: { signedUrl: `https://assinada/${path}` },
                error: null,
              }),
            createSignedUrls: (paths: string[], segundos: number) =>
              chamar("createSignedUrls", [paths, segundos], {
                data: paths.map((path) => ({
                  path,
                  signedUrl: `https://assinada/${path}`,
                  error: null,
                })),
                error: null,
              }),
            download: (path: string) =>
              chamar("download", [path], { data: new Blob([]), error: null }),
          };
        },
      },
      // RPCs usam a fila "rpc:<nome>" e ficam em `chamadas` com tabela "rpc:<nome>".
      rpc: (nome: string, args?: unknown) => {
        chamadas.push({ tabela: `rpc:${nome}`, metodo: "rpc", args: [args] });
        return Promise.resolve(proxima(`rpc:${nome}`));
      },
    },
    chamadas,
    /** Enfileira respostas, na ordem em que as consultas da tabela serão aguardadas. */
    responder(tabela: string, ...respostas: Resposta[]) {
      filas.set(tabela, [...(filas.get(tabela) ?? []), ...respostas]);
    },
    definirPadrao(resposta: Resposta) {
      padrao = resposta;
    },
    /** Chamadas da RPC `nome`; `args[0]` é o objeto de parâmetros. */
    chamadasRpc(nome: string) {
      return chamadas.filter((c) => c.tabela === `rpc:${nome}`);
    },
    chamadasDe(tabela: string, metodo?: string) {
      return chamadas.filter((c) => c.tabela === tabela && (!metodo || c.metodo === metodo));
    },
  };
}
