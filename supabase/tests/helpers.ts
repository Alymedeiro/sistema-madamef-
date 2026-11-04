/**
 * Infraestrutura dos testes de banco (Ruling R1): recria o banco `madame_test`,
 * aplica o shim do Supabase e as migrações, e executa consultas "como" um
 * usuário autenticado (RLS ativo) ou como superusuário (fixtures).
 */
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import type { DatabaseError, PoolClient } from "pg";

export type Perfil = "dona" | "recepcao" | "profissional";

const PASTA_SUPABASE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const PASTA_MIGRACOES = path.join(PASTA_SUPABASE, "migrations");
const ARQUIVO_SHIM = path.join(PASTA_SUPABASE, "tests", "shim.sql");

const URL_TESTE =
  process.env.DATABASE_URL_TEST ??
  "postgres://postgres:postgres@127.0.0.1:5432/madame_test";

function urlComBanco(url: string, banco: string): string {
  const u = new URL(url);
  u.pathname = `/${banco}`;
  return u.toString();
}

const NOME_BANCO = decodeURIComponent(new URL(URL_TESTE).pathname.slice(1));
if (!/^[a-z0-9_]+$/.test(NOME_BANCO) || !NOME_BANCO.includes("test")) {
  // Proteção: este helper apaga o banco inteiro.
  throw new Error(
    `DATABASE_URL_TEST deve apontar para um banco de teste (recebido: "${NOME_BANCO}")`,
  );
}

let pool: pg.Pool | null = null;

function obterPool(): pg.Pool {
  if (!pool) {
    pool = new pg.Pool({ connectionString: URL_TESTE, max: 4 });
  }
  return pool;
}

/** Apaga e recria `madame_test`, aplica shim.sql e todas as migrações em ordem. */
export async function resetarBanco(): Promise<void> {
  await fecharConexoes();

  const admin = new pg.Client({
    connectionString: urlComBanco(URL_TESTE, "postgres"),
  });
  await admin.connect();
  try {
    await admin.query(`drop database if exists ${NOME_BANCO} with (force)`);
    await admin.query(`create database ${NOME_BANCO}`);
  } finally {
    await admin.end();
  }

  const cliente = await obterPool().connect();
  try {
    await cliente.query(await readFile(ARQUIVO_SHIM, "utf8"));
    const migracoes = (await readdir(PASTA_MIGRACOES))
      .filter((arquivo) => arquivo.endsWith(".sql"))
      .sort();
    for (const arquivo of migracoes) {
      const sql = await readFile(path.join(PASTA_MIGRACOES, arquivo), "utf8");
      try {
        await cliente.query(sql);
      } catch (erro) {
        throw new Error(
          `Falha ao aplicar a migração ${arquivo}: ${(erro as Error).message}`,
          { cause: erro },
        );
      }
    }
  } finally {
    cliente.release();
  }
}

/** Lê um arquivo SQL relativo a `supabase/` (ex.: `seed.sql`). */
export function lerSqlSupabase(relativo: string): Promise<string> {
  return readFile(path.join(PASTA_SUPABASE, relativo), "utf8");
}

/**
 * Executa `fn` como superusuário (RLS ignorado) numa transação confirmada.
 * Use para montar fixtures.
 */
export async function comoSuperusuario<T>(
  fn: (c: PoolClient) => Promise<T>,
): Promise<T> {
  const cliente = await obterPool().connect();
  try {
    await cliente.query("begin");
    const resultado = await fn(cliente);
    await cliente.query("commit");
    return resultado;
  } catch (erro) {
    await cliente.query("rollback");
    throw erro;
  } finally {
    cliente.release();
  }
}

/**
 * Executa `fn` como o usuário `uid` (papel `authenticated`) ou como anônimo
 * (`uid = null`, papel `anon`), com RLS ativo. Tudo é desfeito ao final
 * (ROLLBACK), então os testes não vazam dados uns para os outros.
 */
export async function comoUsuario<T>(
  uid: string | null,
  fn: (c: PoolClient) => Promise<T>,
): Promise<T> {
  const cliente = await obterPool().connect();
  try {
    await cliente.query("begin");
    await cliente.query(
      uid === null ? "set local role anon" : "set local role authenticated",
    );
    const claims =
      uid === null
        ? { role: "anon" }
        : { sub: uid, role: "authenticated" };
    await cliente.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify(claims),
    ]);
    return await fn(cliente);
  } finally {
    try {
      await cliente.query("rollback");
    } finally {
      cliente.release();
    }
  }
}

/**
 * Cria um usuário em `auth.users` e o colaborador correspondente (como
 * superusuário, confirmado).
 */
export async function criarUsuario(
  perfil: Perfil,
  opcoes: { ativo?: boolean; nome?: string } = {},
): Promise<{ uid: string; colaboradorId: string }> {
  const { ativo = true, nome = `Teste ${perfil}` } = opcoes;
  return comoSuperusuario(async (c) => {
    const usuario = await c.query<{ id: string }>(
      "insert into auth.users (email) values ($1) returning id",
      [`${perfil}-${randomUUID()}@teste.local`],
    );
    const uid = usuario.rows[0].id;
    const colaborador = await c.query<{ id: string }>(
      `insert into public.colaboradores (usuario_auth_id, nome, perfil, ativo)
       values ($1, $2, $3, $4) returning id`,
      [uid, nome, perfil, ativo],
    );
    return { uid, colaboradorId: colaborador.rows[0].id };
  });
}

/** Cria só o usuário de autenticação, sem colaborador vinculado. */
export async function criarUsuarioSemColaborador(): Promise<string> {
  return comoSuperusuario(async (c) => {
    const r = await c.query<{ id: string }>(
      "insert into auth.users (email) values ($1) returning id",
      [`sem-colaborador-${randomUUID()}@teste.local`],
    );
    return r.rows[0].id;
  });
}

/**
 * Garante que a consulta falha com o SQLSTATE informado (ex.: `23505` para
 * violação de unique, `42501` para RLS/permissão). Retorna o erro do banco.
 *
 * Lembre: após um erro a transação fica abortada — use como última consulta
 * dentro de um `comoUsuario`.
 */
export async function esperarErroSql(
  consulta: Promise<unknown>,
  sqlstate: string,
): Promise<DatabaseError> {
  let erro: unknown;
  try {
    await consulta;
  } catch (e) {
    erro = e;
  }
  if (erro === undefined) {
    throw new Error(
      `Esperava erro SQLSTATE ${sqlstate}, mas a consulta foi bem-sucedida`,
    );
  }
  const codigo = (erro as Partial<DatabaseError>).code;
  if (codigo !== sqlstate) {
    throw new Error(
      `Esperava erro SQLSTATE ${sqlstate}, recebeu ${codigo ?? "sem código"}: ${(erro as Error).message}`,
      { cause: erro },
    );
  }
  return erro as DatabaseError;
}

/** Contagem de linhas visíveis de uma tabela para o papel atual. */
export async function contar(c: PoolClient, tabela: string): Promise<number> {
  const r = await c.query<{ n: number }>(
    `select count(*)::int as n from ${tabela}`,
  );
  return r.rows[0].n;
}

/** Encerra o pool de conexões (use em `afterAll`). */
export async function fecharConexoes(): Promise<void> {
  if (pool) {
    const p = pool;
    pool = null;
    await p.end();
  }
}
