import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  comoSuperusuario,
  comoUsuario,
  criarPacote,
  criarUsuario,
  esperarErroSql,
  fecharConexoes,
  resetarBanco,
} from "./helpers";

// 0008: cortesia (cobrança de total zero), termos/anamneses presos a arquivos
// existentes e únicos, versão do modelo, atendimento da mesma cliente, pacote em
// atendimento já cobrado e vender_pacote idempotente.

const COBRAR = "select registrar_cobranca($1, $2, $3, $4, $5::jsonb) as id";
const VENDER = "select vender_pacote($1, $2, $3, $4, $5::date, $6, $7::jsonb) as id";
const VENDER_ID = "select vender_pacote($1, $2, $3, $4, $5::date, $6, $7::jsonb, $8) as id";
const SQL_OBJ = "insert into storage.objects (bucket_id, name) values ('ficha-clinica', $1)";
const HASH = "a".repeat(64);
const pix = (valor: number) => JSON.stringify([{ forma: "pix", valor_centavos: valor, parcelas: 1 }]);

let dona: string;
let recepcao: string;
let recepcaoId: string;
let profA: string;
let profAId: string;
let cli: string;
let outraCli: string;
let servico: string;
let termoV1: string;

async function logarComo(c: PoolClient, uid: string) {
  await c.query("set local role authenticated");
  await c.query("select set_config('request.jwt.claims', $1, true)", [
    JSON.stringify({ sub: uid, role: "authenticated" }),
  ]);
}

async function comoSuper(c: PoolClient) {
  await c.query("reset role");
  await c.query("select set_config('request.jwt.claims', '', true)");
}

/** Espera o erro sem abortar a transação (savepoint). */
async function falha(c: PoolClient, sql: string, params: unknown[], sqlstate = "P0001") {
  await c.query("savepoint tentativa");
  const erro = await esperarErroSql(c.query(sql, params), sqlstate);
  await c.query("rollback to savepoint tentativa");
  return erro;
}

let hora = 0;
async function agendar(
  c: PoolClient,
  p: { status?: string; cliente?: string; valor?: number; inicio?: string } = {},
): Promise<string> {
  hora += 1;
  const inicio = p.inicio ?? new Date(Date.UTC(2031, 0, 1, hora)).toISOString();
  const r = await c.query<{ id: string }>(
    `insert into agendamentos (cliente_id, profissional_id, servico_id, inicio, fim,
       status, valor_previsto_centavos)
     values ($1, $2, $3, $4::timestamptz, $4::timestamptz + interval '30 minutes', $5, $6)
     returning id`,
    [p.cliente ?? cli, profAId, servico, inicio, p.status ?? "atendido", p.valor ?? 10000],
  );
  return r.rows[0].id;
}

const caminho = (cliente: string, area: string, ext: string) =>
  `clientes/${cliente}/${area}/${randomUUID()}.${ext}`;

/** Superusuário, confirmado: grava os objetos no bucket. */
const gravarObjetos = (...nomes: string[]) =>
  comoSuperusuario(async (c) => {
    for (const n of nomes) await c.query(SQL_OBJ, [n]);
  });

const INSERT_TERMO = `insert into termos_assinados
  (cliente_id, modelo_termo_id, modelo_versao, agendamento_id, assinatura_path, pdf_path, hash_sha256)
  values ($1, $2, 1, $3, $4, $5, $6) returning id`;
const INSERT_ANAMNESE = `insert into anamneses (cliente_id, modelo_id, modelo_versao, respostas, assinatura_path)
  select $1, id, coalesce($3, versao), '{}'::jsonb, $2 from modelos_anamnese where ativo returning id`;

beforeAll(async () => {
  await resetarBanco();
  dona = (await criarUsuario("dona")).uid;
  ({ uid: recepcao, colaboradorId: recepcaoId } = await criarUsuario("recepcao"));
  ({ uid: profA, colaboradorId: profAId } = await criarUsuario("profissional"));

  await comoSuperusuario(async (c) => {
    const id = async (sql: string, p: unknown[] = []) =>
      (await c.query<{ id: string }>(sql, p)).rows[0].id;
    cli = await id("insert into clientes (nome, aceite_lgpd_em) values ('Cli', now()) returning id");
    outraCli = await id("insert into clientes (nome, aceite_lgpd_em) values ('Outra', now()) returning id");
    const cat = await id("insert into categorias_servico (nome) values ('Facial') returning id");
    servico = await id(
      `insert into servicos (nome, categoria_id, duracao_min, preco_centavos)
       values ('Peeling', $1, 30, 10000) returning id`,
      [cat],
    );
    termoV1 = await id("select id from modelos_termo where ativo");
    // Vínculo da profissional A com as duas clientes.
    await agendar(c, { status: "confirmado" });
    await agendar(c, { status: "confirmado", cliente: outraCli });
  });
});

afterAll(fecharConexoes);

describe("cortesia: cobrança de total zero", () => {
  it("valor previsto 0: '[]' registra a cobrança sem pagamentos e tira das listas", async () => {
    await comoUsuario(recepcao, async (c) => {
      await c.query("select abrir_caixa(0)");
      await comoSuper(c);
      const ag = await agendar(c, { valor: 0, inicio: new Date().toISOString() });
      await logarComo(c, recepcao);
      const hoje = (
        await c.query<{ d: string }>("select ((now() at time zone 'America/Sao_Paulo')::date)::text as d")
      ).rows[0].d;
      expect(
        (await c.query("select * from agendamentos_sem_pagamento($1::date) as id", [hoje])).rows.map(
          (l) => l.id,
        ),
      ).toContain(ag);

      const id = (await c.query<{ id: string }>(COBRAR, ["agendamento", ag, null, 0, "[]"])).rows[0].id;
      const cob = (
        await c.query("select valor_bruto_centavos, desconto_centavos from cobrancas where id = $1", [id])
      ).rows;
      expect(cob).toEqual([{ valor_bruto_centavos: 0, desconto_centavos: 0 }]);
      expect((await c.query("select count(*)::int as n from pagamentos where cobranca_id = $1", [id])).rows[0].n).toBe(0);
      expect(
        (await c.query("select * from agendamentos_sem_pagamento($1::date) as id", [hoje])).rows.map(
          (l) => l.id,
        ),
      ).not.toContain(ag);
    });
  });

  it("desconto de 100%: '[]' aceito; fechar_caixa não muda", async () => {
    await comoUsuario(recepcao, async (c) => {
      const caixa = (await c.query<{ id: string }>("select abrir_caixa(0) as id")).rows[0].id;
      await comoSuper(c);
      const cortesia = await agendar(c);
      const pago = await agendar(c);
      await logarComo(c, recepcao);
      await c.query(COBRAR, ["agendamento", cortesia, null, 10000, "[]"]);
      await c.query(COBRAR, ["agendamento", pago, null, 0, pix(10000)]);
      const f = (
        await c.query<{ f: { total_geral: number; dinheiro_esperado: number } }>(
          "select fechar_caixa($1, 0) as f",
          [caixa],
        )
      ).rows[0].f;
      expect(f.total_geral).toBe(10000);
      expect(f.dinheiro_esperado).toBe(0);
    });
  });

  it("'[]' com total > 0 continua recusado; parte de valor 0 também", async () => {
    await comoUsuario(recepcao, async (c) => {
      await c.query("select abrir_caixa(0)");
      await comoSuper(c);
      const ag = await agendar(c);
      const zero = await agendar(c, { valor: 0 });
      await logarComo(c, recepcao);
      expect((await falha(c, COBRAR, ["agendamento", ag, null, 9999, "[]"])).message).toBe(
        "Informe de 1 a 4 formas de pagamento.",
      );
      expect((await falha(c, COBRAR, ["agendamento", zero, null, 0, pix(0)])).message).toBe(
        "Cada forma de pagamento deve ter valor maior que zero.",
      );
    });
  });

  it("pacote: bruto 0 recusado pelo check; desconto total aceita '[]'", async () => {
    await comoSuperusuario(async (c) => {
      const caixa = (
        await c.query<{ id: string }>(
          "insert into caixas (data, valor_inicial_centavos, aberto_por) values ('2031-02-01', 0, $1) returning id",
          [recepcaoId],
        )
      ).rows[0].id;
      const p = await criarPacote(c, { clienteId: cli, servicoId: servico });
      await c.query("savepoint s");
      await esperarErroSql(
        c.query(
          `insert into cobrancas (origem, pacote_vendido_id, cliente_id, valor_bruto_centavos, caixa_id, lancada_por)
           values ('pacote', $1, $2, 0, $3, $4)`,
          [p, cli, caixa, recepcaoId],
        ),
        "23514",
      );
      await c.query("rollback to savepoint s");
      // Atendimento com bruto 0 é aceito pelo check.
      const ag = await agendar(c, { valor: 0 });
      await c.query(
        `insert into cobrancas (origem, agendamento_id, cliente_id, valor_bruto_centavos, caixa_id, lancada_por)
         values ('agendamento', $1, $2, 0, $3, $4)`,
        [ag, cli, caixa, recepcaoId],
      );
      throw new Error("ROLLBACK");
    }).catch((e: Error) => {
      if (e.message !== "ROLLBACK") throw e;
    });

    await comoUsuario(recepcao, async (c) => {
      await c.query("select abrir_caixa(0)");
      const p = (await c.query<{ id: string }>(VENDER, [cli, servico, 2, 50000, null, 50000, "[]"])).rows[0].id;
      expect(
        (await c.query("select count(*)::int as n from pagamentos p join cobrancas c on c.id = p.cobranca_id where c.pacote_vendido_id = $1", [p])).rows[0].n,
      ).toBe(0);
    });
  });
});

describe("termos e anamneses: arquivos existentes e únicos", () => {
  it("termo sem os dois arquivos no bucket é negado (42501); com os dois, grava", async () => {
    const png = caminho(cli, "termos", "png");
    const pdf = caminho(cli, "termos", "pdf");
    await comoUsuario(recepcao, (c) =>
      esperarErroSql(c.query(INSERT_TERMO, [cli, termoV1, null, png, pdf, HASH]), "42501"),
    );
    await gravarObjetos(pdf);
    await comoUsuario(recepcao, (c) =>
      esperarErroSql(c.query(INSERT_TERMO, [cli, termoV1, null, png, pdf, HASH]), "42501"),
    );
    // Arquivo em outro bucket não conta.
    await comoSuperusuario(async (c) => {
      await c.query("insert into storage.buckets (id, name) values ('outro', 'outro') on conflict do nothing");
      await c.query("insert into storage.objects (bucket_id, name) values ('outro', $1)", [png]);
    });
    await comoUsuario(recepcao, (c) =>
      esperarErroSql(c.query(INSERT_TERMO, [cli, termoV1, null, png, pdf, HASH]), "42501"),
    );
    await gravarObjetos(png);
    await comoUsuario(recepcao, async (c) => {
      await c.query(INSERT_TERMO, [cli, termoV1, null, png, pdf, HASH]);
    });
  });

  it("o mesmo PDF ou a mesma assinatura em dois termos: 23505", async () => {
    const png = caminho(cli, "termos", "png");
    const png2 = caminho(cli, "termos", "png");
    const pdf = caminho(cli, "termos", "pdf");
    const pdf2 = caminho(cli, "termos", "pdf");
    await gravarObjetos(png, png2, pdf, pdf2);
    await comoUsuario(recepcao, async (c) => {
      await c.query(INSERT_TERMO, [cli, termoV1, null, png, pdf, HASH]);
      const e = await falha(c, INSERT_TERMO, [cli, termoV1, null, png2, pdf, HASH], "23505");
      expect(e.message).toContain("termos_assinados_pdf_path_key");
      const e2 = await falha(c, INSERT_TERMO, [cli, termoV1, null, png, pdf2, HASH], "23505");
      expect(e2.message).toContain("termos_assinados_assinatura_path_key");
    });
  });

  it("anamnese: assinatura precisa existir no bucket e ser única", async () => {
    const png = caminho(cli, "anamneses", "png");
    await comoUsuario(recepcao, (c) =>
      esperarErroSql(c.query(INSERT_ANAMNESE, [cli, png, null]), "42501"),
    );
    await gravarObjetos(png);
    await comoUsuario(recepcao, async (c) => {
      await c.query(INSERT_ANAMNESE, [cli, png, null]);
      const e = await falha(c, INSERT_ANAMNESE, [cli, png, null], "23505");
      expect(e.message).toContain("anamneses_assinatura_path_key");
    });
  });

  it("anamnese: versão diferente da do modelo é recusada (também como superusuário)", async () => {
    const png = caminho(cli, "anamneses", "png");
    await gravarObjetos(png);
    await comoUsuario(recepcao, async (c) => {
      const e = await falha(c, INSERT_ANAMNESE, [cli, png, 99]);
      expect(e.message).toBe("Versão do modelo de anamnese inválida.");
      await comoSuper(c);
      const e2 = await falha(
        c,
        `insert into anamneses (cliente_id, modelo_id, modelo_versao, respostas, assinatura_path, preenchida_por)
         select $1, id, versao + 1, '{}'::jsonb, $2, $3 from modelos_anamnese where ativo`,
        [cli, png, recepcaoId],
      );
      expect(e2.message).toBe("Versão do modelo de anamnese inválida.");
    });
  });

  it("arquivo_ficha_existe: authenticated executa, anônimo não", async () => {
    const r = await comoSuperusuario((c) =>
      c.query(
        `select has_function_privilege('authenticated', 'public.arquivo_ficha_existe(text)', 'execute') as auth,
                has_function_privilege('anon', 'public.arquivo_ficha_existe(text)', 'execute') as anon`,
      ),
    );
    expect(r.rows[0]).toEqual({ auth: true, anon: false });
  });
});

describe("atendimento ligado à ficha é da mesma cliente", () => {
  it("foto, termo e evolução com atendimento de outra cliente: P0001", async () => {
    const msg = "O atendimento é de outra cliente.";
    await comoSuperusuario(async (c) => {
      // Superusuário (sem RLS), mas com a recepção nos padrões (colhido_por).
      await c.query("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify({ sub: recepcao, role: "authenticated" }),
      ]);
      const deOutra = await agendar(c, { cliente: outraCli });
      const daCli = await agendar(c);
      const foto = caminho(cli, "fotos", "jpg");
      const png = caminho(cli, "termos", "png");
      const pdf = caminho(cli, "termos", "pdf");
      for (const n of [foto, png, pdf]) await c.query(SQL_OBJ, [n]);

      const sqlFoto = `insert into fotos (cliente_id, agendamento_id, tipo, path, enviada_por)
                       values ($1, $2, 'antes', $3, $4)`;
      expect((await falha(c, sqlFoto, [cli, deOutra, foto, profAId])).message).toBe(msg);
      expect((await falha(c, INSERT_TERMO, [cli, termoV1, deOutra, png, pdf, HASH])).message).toBe(msg);
      const sqlEvo = `insert into evolucoes (cliente_id, agendamento_id, profissional_id, texto)
                      values ($1, $2, $3, 'ok')`;
      expect((await falha(c, sqlEvo, [cli, deOutra, profAId])).message).toBe(msg);

      // Mesma cliente (ou sem atendimento) continua valendo.
      await c.query(sqlFoto, [cli, daCli, foto, profAId]);
      await c.query(INSERT_TERMO, [cli, termoV1, daCli, png, pdf, HASH]);
      await c.query(sqlEvo, [cli, daCli, profAId]);
      throw new Error("ROLLBACK");
    }).catch((e: Error) => {
      if (e.message !== "ROLLBACK") throw e;
    });
  });

  it("profissional também é barrada (foto pela política + gatilho)", async () => {
    const foto = caminho(cli, "fotos", "jpg");
    await gravarObjetos(foto);
    let deOutra = "";
    await comoSuperusuario(async (c) => {
      deOutra = await agendar(c, { cliente: outraCli });
    });
    await comoUsuario(profA, async (c) => {
      const e = await esperarErroSql(
        c.query("insert into fotos (cliente_id, agendamento_id, tipo, path) values ($1, $2, 'antes', $3)", [
          cli,
          deOutra,
          foto,
        ]),
        "P0001",
      );
      expect(e.message).toBe("O atendimento é de outra cliente.");
    });
  });
});

describe("pacote em atendimento já cobrado", () => {
  it("vincular pacote depois da cobrança é recusado", async () => {
    await comoUsuario(recepcao, async (c) => {
      await c.query("select abrir_caixa(0)");
      await comoSuper(c);
      const ag = await agendar(c);
      const p = await criarPacote(c, { clienteId: cli, servicoId: servico });
      await logarComo(c, recepcao);
      await c.query(COBRAR, ["agendamento", ag, null, 0, pix(10000)]);
      await comoSuper(c);
      await c.query("update agendamentos set status = 'confirmado' where id = $1", [ag]);
      const e = await falha(c, "update agendamentos set pacote_vendido_id = $2 where id = $1", [ag, p]);
      expect(e.message).toBe("Este atendimento já foi cobrado; não é possível usar pacote.");
      // Sem cobrança, o vínculo continua permitido.
      const livre = await agendar(c, { status: "confirmado" });
      await c.query("update agendamentos set pacote_vendido_id = $2 where id = $1", [livre, p]);
    });
  });
});

describe("vender_pacote idempotente", () => {
  it("o mesmo p_id duas vezes: 23505 pacotes_vendidos_pkey, uma venda só", async () => {
    await comoUsuario(recepcao, async (c) => {
      await c.query("select abrir_caixa(0)");
      const id = randomUUID();
      const r = (await c.query<{ id: string }>(VENDER_ID, [cli, servico, 2, 50000, null, 0, pix(50000), id]))
        .rows[0].id;
      expect(r).toBe(id);
      const e = await falha(c, VENDER_ID, [cli, servico, 2, 50000, null, 0, pix(50000), id], "23505");
      expect(e.message).toContain("pacotes_vendidos_pkey");
      expect(
        (await c.query("select count(*)::int as n from cobrancas where pacote_vendido_id = $1", [id])).rows[0].n,
      ).toBe(1);
      // Sem p_id continua funcionando (o banco gera o id).
      await c.query(VENDER, [cli, servico, 2, 50000, null, 0, pix(50000)]);
    });
  });

  it("uma única versão da função, só para authenticated", async () => {
    const r = await comoSuperusuario((c) =>
      c.query(
        `select pg_get_function_identity_arguments(p.oid) as args,
                has_function_privilege('authenticated', p.oid, 'execute') as auth,
                has_function_privilege('anon', p.oid, 'execute') as anon
         from pg_proc p where p.proname = 'vender_pacote' and p.pronamespace = 'public'::regnamespace`,
      ),
    );
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].args).toContain("p_id uuid");
    expect(r.rows[0]).toMatchObject({ auth: true, anon: false });
  });

  it("dona também vende com p_id", async () => {
    await comoUsuario(dona, async (c) => {
      await c.query("select abrir_caixa(0)");
      const id = randomUUID();
      await c.query(VENDER_ID, [cli, servico, 1, 1000, null, 0, pix(1000), id]);
    });
  });
});
