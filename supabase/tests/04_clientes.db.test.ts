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

let dona: string;
let recepcao: string;
let profA: string;
let profAId: string;
let profB: string;
let clienteVinculada: string;
let clienteOutra: string;

beforeAll(async () => {
  await resetarBanco();
  dona = (await criarUsuario("dona")).uid;
  recepcao = (await criarUsuario("recepcao")).uid;
  const a = await criarUsuario("profissional", { nome: "Prof A" });
  profA = a.uid;
  profAId = a.colaboradorId;
  profB = (await criarUsuario("profissional", { nome: "Prof B" })).uid;

  await comoSuperusuario(async (c) => {
    const cat = await c.query<{ id: string }>(
      "insert into categorias_servico (nome) values ('Facial') returning id",
    );
    const serv = await c.query<{ id: string }>(
      `insert into servicos (nome, categoria_id, duracao_min, preco_centavos)
       values ('Peeling', $1, 60, 25000) returning id`,
      [cat.rows[0].id],
    );
    const cliente = async (nome: string) =>
      (
        await c.query<{ id: string }>(
          "insert into clientes (nome, aceite_lgpd_em) values ($1, now()) returning id",
          [nome],
        )
      ).rows[0].id;
    clienteVinculada = await cliente("Ânã Conceição");
    clienteOutra = await cliente("Beatriz");
    await c.query(
      `insert into agendamentos (cliente_id, profissional_id, servico_id, inicio, fim)
       values ($1, $2, $3, '2030-01-07T10:00:00-03:00', '2030-01-07T11:00:00-03:00')`,
      [clienteVinculada, profAId, serv.rows[0].id],
    );
  });
});

afterAll(fecharConexoes);

describe("normalizar_busca / nome_busca", () => {
  it("nome_busca de 'Ânã Conceição' é 'ana conceicao'", async () => {
    const r = await comoSuperusuario((c) =>
      c.query<{ nome_busca: string }>("select nome_busca from clientes where id = $1", [
        clienteVinculada,
      ]),
    );
    expect(r.rows[0].nome_busca).toBe("ana conceicao");
  });

  it("a função é imutável e funciona sem extensions no search_path", async () => {
    const r = await comoSuperusuario((c) =>
      c.query<{ volatilidade: string; texto: string }>(
        `select p.provolatile as volatilidade, public.normalizar_busca('JOSÉ Müller') as texto
         from pg_proc p where p.proname = 'normalizar_busca'`,
      ),
    );
    expect(r.rows[0]).toEqual({ volatilidade: "i", texto: "jose muller" });
  });

  it("recepção cadastra e a coluna gerada é preenchida (RLS ativo)", async () => {
    await comoUsuario(recepcao, async (c) => {
      const r = await c.query<{ nome_busca: string }>(
        `insert into clientes (nome, aceite_lgpd_em) values ('Mônica Çelik', now())
         returning nome_busca`,
      );
      expect(r.rows[0].nome_busca).toBe("monica celik");
      const achou = await c.query(
        "select 1 from clientes where nome_busca ilike '%monica%'",
      );
      expect(achou.rowCount).toBe(1);
    });
  });

  it("não aceita gravar nome_busca à mão (coluna gerada)", async () => {
    await comoUsuario(dona, async (c) => {
      await esperarErroSql(
        c.query("update clientes set nome_busca = 'x' where id = $1", [clienteOutra]),
        "428C9",
      );
    });
  });

  it("existe índice de trigramas em nome_busca e o do nome cru foi removido", async () => {
    const r = await comoSuperusuario((c) =>
      c.query<{ indexname: string; indexdef: string }>(
        `select indexname, indexdef from pg_indexes
         where schemaname = 'public' and tablename = 'clientes'`,
      ),
    );
    const nomes = r.rows.map((i) => i.indexname);
    const idx = r.rows.find((i) => i.indexname === "clientes_nome_busca_trgm_idx");
    expect(idx?.indexdef).toMatch(/USING gin \(nome_busca extensions\.gin_trgm_ops\)/);
    expect(nomes).not.toContain("clientes_nome_trgm_idx");
  });

  it("o planejador usa o índice de trigramas na busca por nome", async () => {
    // Como superusuário (o RLS impede o uso do índice por operadores que não são
    // leakproof, o que não importa no volume de uma clínica). As linhas de volume
    // são removidas na mesma transação.
    await comoSuperusuario(async (c) => {
      await c.query(
        `insert into clientes (nome, aceite_lgpd_em)
         select 'Volume ' || g, now() from generate_series(1, 3000) g`,
      );
      await c.query("analyze clientes");
      await c.query("set local enable_seqscan = off");
      const plano = await c.query<{ "QUERY PLAN": string }>(
        "explain select id from clientes where nome_busca ilike '%conceicao%'",
      );
      expect(plano.rows.map((l) => l["QUERY PLAN"]).join("\n")).toContain(
        "clientes_nome_busca_trgm_idx",
      );
      await c.query("delete from clientes where nome like 'Volume %'");
    });
  });
});

describe("RLS de clientes segue igual", () => {
  it("dona e recepção veem todas; profissional só as vinculadas", async () => {
    const total = await comoUsuario(dona, (c) => contar(c, "clientes"));
    expect(total).toBeGreaterThanOrEqual(2);
    expect(await comoUsuario(recepcao, (c) => contar(c, "clientes"))).toBe(total);

    await comoUsuario(profA, async (c) => {
      const r = await c.query<{ id: string }>("select id from clientes");
      expect(r.rows.map((l) => l.id)).toEqual([clienteVinculada]);
      // A busca por nome também respeita o RLS.
      const busca = await c.query("select 1 from clientes where nome_busca ilike '%beatriz%'");
      expect(busca.rowCount).toBe(0);
    });
    expect(await comoUsuario(profB, (c) => contar(c, "clientes"))).toBe(0);
  });

  it("profissional não cadastra nem altera clientes", async () => {
    await comoUsuario(profA, async (c) => {
      await esperarErroSql(
        c.query("insert into clientes (nome, aceite_lgpd_em) values ('X', now())"),
        "42501",
      );
    });
    await comoUsuario(profA, async (c) => {
      const r = await c.query("update clientes set observacoes = 'x' where id = $1", [
        clienteVinculada,
      ]);
      expect(r.rowCount).toBe(0);
    });
  });
});
