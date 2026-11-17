import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  comoSuperusuario,
  comoUsuario,
  contar,
  criarUsuario,
  esperarErroSql,
  fecharConexoes,
  resetarBanco,
} from "./helpers";

// 0020: fotos dos serviços (servicos_fotos, limite de 5, reordenar_fotos_servico)
// e o bucket público `servicos-fotos` com escrita só da dona.

let dona: string;
let recepcao: string;
let profissional: string;
let servicoOnline: string; // ativo + permite_online
let servicoInterno: string; // ativo, sem permite_online
let servicoInativo: string; // inativo, com permite_online

const caminho = (servico: string, ext = "webp") => `servicos/${servico}/${randomUUID()}.${ext}`;
const SQL_FOTO =
  "insert into servicos_fotos (servico_id, caminho, largura, altura) values ($1, $2, 1600, 1200) returning id, ordem";
const SQL_OBJ = "insert into storage.objects (bucket_id, name) values ('servicos-fotos', $1)";

async function tentar(c: PoolClient, sql: string, params: unknown[], sqlstate: string) {
  await c.query("savepoint tentativa");
  const erro = await esperarErroSql(c.query(sql, params), sqlstate);
  await c.query("rollback to savepoint tentativa");
  return erro;
}

async function ordens(c: PoolClient, servico: string) {
  const r = await c.query<{ id: string; ordem: number }>(
    "select id, ordem from servicos_fotos where servico_id = $1 order by ordem",
    [servico],
  );
  return r.rows;
}

beforeAll(async () => {
  await resetarBanco();
  ({ uid: dona } = await criarUsuario("dona"));
  ({ uid: recepcao } = await criarUsuario("recepcao"));
  ({ uid: profissional } = await criarUsuario("profissional"));
  await comoSuperusuario(async (c) => {
    const cat = await c.query<{ id: string }>(
      "insert into categorias_servico (nome) values ('Facial') returning id",
    );
    const criar = async (nome: string, ativo: boolean, online: boolean) =>
      (
        await c.query<{ id: string }>(
          `insert into servicos (nome, categoria_id, duracao_min, preco_centavos, permite_online, ativo)
           values ($1, $2, 60, 10000, $3, $4) returning id`,
          [nome, cat.rows[0].id, online, ativo],
        )
      ).rows[0].id;
    servicoOnline = await criar("Limpeza", true, true);
    servicoInterno = await criar("Peeling", true, false);
    servicoInativo = await criar("Antigo", false, true);
    for (const s of [servicoOnline, servicoInterno, servicoInativo]) {
      await c.query(SQL_FOTO, [s, caminho(s)]);
    }
  });
});

afterAll(fecharConexoes);

describe("servicos_fotos — escrita da dona", () => {
  it("dona insere: ordem automática na próxima livre, criado_por = ela", async () => {
    await comoUsuario(dona, async (c) => {
      const a = await c.query(SQL_FOTO, [servicoOnline, caminho(servicoOnline)]);
      const b = await c.query(SQL_FOTO, [servicoOnline, caminho(servicoOnline, "jpg")]);
      expect(a.rows[0].ordem).toBe(1);
      expect(b.rows[0].ordem).toBe(2);
      const r = await c.query(
        "select criado_por = colaborador_atual_id() as minha from servicos_fotos where id = $1",
        [a.rows[0].id],
      );
      expect(r.rows[0].minha).toBe(true);
    });
  });

  it("caminho precisa estar na pasta do serviço e ser .webp/.jpg", async () => {
    await comoUsuario(dona, async (c) => {
      await tentar(c, SQL_FOTO, [servicoOnline, caminho(servicoInterno)], "23514");
      await tentar(c, SQL_FOTO, [servicoOnline, `servicos/${servicoOnline}/x.gif`], "23514");
    });
  });

  it("6ª foto é recusada com a mensagem", async () => {
    await comoUsuario(dona, async (c) => {
      for (let i = 0; i < 4; i++) await c.query(SQL_FOTO, [servicoOnline, caminho(servicoOnline)]);
      expect(await ordens(c, servicoOnline)).toHaveLength(5);
      const erro = await tentar(c, SQL_FOTO, [servicoOnline, caminho(servicoOnline)], "P0001");
      expect(erro.message).toBe("Cada serviço pode ter no máximo 5 fotos.");
    });
  });

  it("dona reordena: ordem regravada 0..n-1", async () => {
    await comoUsuario(dona, async (c) => {
      await c.query(SQL_FOTO, [servicoOnline, caminho(servicoOnline)]);
      await c.query(SQL_FOTO, [servicoOnline, caminho(servicoOnline)]);
      const antes = (await ordens(c, servicoOnline)).map((f) => f.id);
      const nova = [antes[2], antes[0], antes[1]];
      await c.query("select reordenar_fotos_servico($1, $2)", [servicoOnline, nova]);
      expect((await ordens(c, servicoOnline)).map((f) => f.id)).toEqual(nova);
      // O unique (servico_id, ordem) é conferido no commit.
      await c.query("set constraints all immediate");
    });
  });

  it("reordenar com ids errados é recusado", async () => {
    await comoUsuario(dona, async (c) => {
      await c.query(SQL_FOTO, [servicoOnline, caminho(servicoOnline)]);
      const ids = (await ordens(c, servicoOnline)).map((f) => f.id);
      const sql = "select reordenar_fotos_servico($1, $2)";
      const outra = (await ordens(c, servicoInterno))[0].id;
      for (const errados of [[ids[0]], [ids[0], ids[0]], [ids[0], outra], [...ids, randomUUID()]]) {
        const erro = await tentar(c, sql, [servicoOnline, errados], "P0001");
        expect(erro.message).toBe("A lista de fotos não confere com as fotos do serviço.");
      }
    });
  });

  it("dona remove: as demais são renumeradas a partir da capa", async () => {
    await comoUsuario(dona, async (c) => {
      await c.query(SQL_FOTO, [servicoOnline, caminho(servicoOnline)]);
      await c.query(SQL_FOTO, [servicoOnline, caminho(servicoOnline)]);
      const [capa, segunda, terceira] = await ordens(c, servicoOnline);
      const r = await c.query("delete from servicos_fotos where id = $1", [capa.id]);
      expect(r.rowCount).toBe(1);
      expect(await ordens(c, servicoOnline)).toEqual([
        { id: segunda.id, ordem: 0 },
        { id: terceira.id, ordem: 1 },
      ]);
      await c.query("set constraints all immediate");
    });
  });
});

describe("servicos_fotos — demais perfis e anônimo", () => {
  for (const perfil of ["recepcao", "profissional"] as const) {
    it(`${perfil} lê todas, mas não escreve nem reordena`, async () => {
      const uid = perfil === "recepcao" ? recepcao : profissional;
      await comoUsuario(uid, async (c) => {
        expect(await contar(c, "servicos_fotos")).toBe(3);
        await tentar(c, SQL_FOTO, [servicoOnline, caminho(servicoOnline)], "42501");
        expect((await c.query("update servicos_fotos set largura = 1")).rowCount).toBe(0);
        expect((await c.query("delete from servicos_fotos")).rowCount).toBe(0);
        const id = (await ordens(c, servicoOnline))[0].id;
        await tentar(c, "select reordenar_fotos_servico($1, $2)", [servicoOnline, [id]], "42501");
      });
    });
  }

  it("anônimo lê só fotos de serviços ativos e online; não escreve", async () => {
    await comoUsuario(null, async (c) => {
      const r = await c.query<{ servico_id: string }>("select servico_id from servicos_fotos");
      expect(r.rows.map((x) => x.servico_id)).toEqual([servicoOnline]);
      await tentar(c, SQL_FOTO, [servicoOnline, caminho(servicoOnline)], "42501");
      expect((await c.query("delete from servicos_fotos")).rowCount).toBe(0);
      await tentar(c, "select reordenar_fotos_servico($1, $2)", [servicoOnline, []], "42501");
    });
  });
});

describe("bucket servicos-fotos", () => {
  it("é público, com limite de 2 MB e só imagens", async () => {
    const r = await comoSuperusuario((c) =>
      c.query("select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'servicos-fotos'"),
    );
    expect(r.rows[0]).toEqual({
      public: true,
      file_size_limit: "2097152",
      allowed_mime_types: ["image/jpeg", "image/webp", "image/png"],
    });
  });

  it("dona envia, troca e apaga arquivos na pasta servicos/", async () => {
    await comoUsuario(dona, async (c) => {
      const nome = caminho(servicoOnline);
      await c.query(SQL_OBJ, [nome]);
      await tentar(c, SQL_OBJ, [`outra/${randomUUID()}.webp`], "42501");
      expect(
        (await c.query("update storage.objects set metadata = '{}' where name = $1", [nome])).rowCount,
      ).toBe(1);
      expect((await c.query("delete from storage.objects where name = $1", [nome])).rowCount).toBe(1);
    });
  });

  for (const quem of ["recepcao", "profissional", "anon"] as const) {
    it(`${quem} não envia nem apaga`, async () => {
      const nome = caminho(servicoOnline);
      await comoSuperusuario((c) => c.query(SQL_OBJ, [nome]));
      const uid = quem === "anon" ? null : quem === "recepcao" ? recepcao : profissional;
      await comoUsuario(uid, async (c) => {
        await tentar(c, SQL_OBJ, [caminho(servicoOnline)], "42501");
        expect((await c.query("update storage.objects set metadata = '{}'")).rowCount).toBe(0);
        expect((await c.query("delete from storage.objects")).rowCount).toBe(0);
      });
    });
  }
});
