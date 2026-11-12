import type { PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  comoUsuario,
  criarUsuario,
  esperarErroSql,
  fecharConexoes,
  resetarBanco,
} from "./helpers";

// 0018: conversas_arquivadas + arquivar_conversas / desarquivar_conversas.

const MSG_EQUIPE = "Apenas a dona ou a recepção podem enviar mensagens.";
const MSG_VAZIO = "Escolha pelo menos uma conversa.";

let dona: string;
let recepcao: string;
let prof: string;

async function falha(c: PoolClient, sql: string, params: unknown[], sqlstate = "P0001") {
  await c.query("savepoint tentativa");
  const erro = await esperarErroSql(c.query(sql, params), sqlstate);
  await c.query("rollback to savepoint tentativa");
  return erro;
}

const arquivar = (c: PoolClient, chaves: string[] | null) =>
  c.query<{ n: number }>("select arquivar_conversas($1) as n", [chaves]);

beforeAll(async () => {
  await resetarBanco();
  dona = (await criarUsuario("dona")).uid;
  recepcao = (await criarUsuario("recepcao")).uid;
  prof = (await criarUsuario("profissional")).uid;
});

afterAll(fecharConexoes);

describe("conversas arquivadas", () => {
  it("recepção arquiva e desarquiva", () =>
    comoUsuario(recepcao, async (c) => {
      expect((await arquivar(c, ["a", "b", "a"])).rows[0].n).toBe(2);
      const lista = await c.query("select chave, arquivada_por from conversas_arquivadas order by chave");
      expect(lista.rows.map((r) => r.chave)).toEqual(["a", "b"]);
      expect(lista.rows[0].arquivada_por).not.toBeNull();

      const d = await c.query<{ n: number }>("select desarquivar_conversas($1) as n", [["a", "x"]]);
      expect(d.rows[0].n).toBe(1);
      const resto = await c.query("select chave from conversas_arquivadas");
      expect(resto.rows.map((r) => r.chave)).toEqual(["b"]);
    }));

  it("dona também arquiva", () =>
    comoUsuario(dona, async (c) => {
      expect((await arquivar(c, ["z"])).rows[0].n).toBe(1);
    }));

  it("profissional é recusada (funções e tabela)", () =>
    comoUsuario(prof, async (c) => {
      expect(await falha(c, "select arquivar_conversas($1)", [["a"]])).toMatchObject({
        message: MSG_EQUIPE,
      });
      expect(await falha(c, "select desarquivar_conversas($1)", [["a"]])).toMatchObject({
        message: MSG_EQUIPE,
      });
      await falha(c, "insert into conversas_arquivadas (chave) values ('a')", [], "42501");
      expect((await c.query("select 1 from conversas_arquivadas")).rowCount).toBe(0);
    }));

  it("escrita direta é negada até para a recepção", () =>
    comoUsuario(recepcao, async (c) => {
      await arquivar(c, ["a"]);
      await falha(
        c,
        "insert into conversas_arquivadas (chave, arquivada_em) values ('b', now() + interval '1 year')",
        [],
        "42501",
      );
      await falha(c, "update conversas_arquivadas set arquivada_em = now() + interval '1 year'", [], "42501");
      await falha(c, "delete from conversas_arquivadas", [], "42501");
      expect((await c.query("select 1 from conversas_arquivadas")).rowCount).toBe(1);
    }));

  it("anônimo não executa as funções", () =>
    comoUsuario(null, async (c) => {
      await falha(c, "select arquivar_conversas($1)", [["a"]], "42501");
    }));

  it("vazio, nulo e mais de 200 são recusados", () =>
    comoUsuario(recepcao, async (c) => {
      for (const v of [[], null, ["", "  "]]) {
        expect(await falha(c, "select arquivar_conversas($1)", [v])).toMatchObject({
          message: MSG_VAZIO,
        });
        expect(await falha(c, "select desarquivar_conversas($1)", [v])).toMatchObject({
          message: MSG_VAZIO,
        });
      }
      const muitas = Array.from({ length: 201 }, (_, i) => `k${i}`);
      await falha(c, "select arquivar_conversas($1)", [muitas]);
      expect((await arquivar(c, muitas.slice(0, 200))).rows[0].n).toBe(200);
    }));

  it("arquivar de novo atualiza arquivada_em", () =>
    comoUsuario(recepcao, async (c) => {
      await arquivar(c, ["a"]);
      await c.query("reset role");
      await c.query(
        "update conversas_arquivadas set arquivada_em = now() - interval '1 day' where chave = 'a'",
      );
      await c.query("set local role authenticated");
      await arquivar(c, ["a"]);
      const r = await c.query<{ recente: boolean }>(
        "select arquivada_em > now() - interval '1 minute' as recente from conversas_arquivadas where chave = 'a'",
      );
      expect(r.rows[0].recente).toBe(true);
      expect((await c.query("select 1 from conversas_arquivadas")).rowCount).toBe(1);
    }));
});
