import type { PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  comoSuperusuario,
  comoUsuario,
  contar,
  criarPacote,
  criarUsuario,
  esperarErroSql,
  fecharConexoes,
  inserirPagamentoDireto,
  resetarBanco,
} from "./helpers";

// "Hoje" é sempre a data de São Paulo calculada pelo próprio banco. Dentro de
// uma transação now() é fixo, então os testes que dependem de "hoje" rodam
// numa transação só (comoUsuario) e trocam de usuário com logarComo().
const HOJE = "(now() at time zone 'America/Sao_Paulo')::date";

const MSG_ABRA_O_CAIXA = "Abra o caixa do dia antes de lançar pagamentos";
const MSG_JA_EXISTE = "Já existe caixa para hoje";

const FORMAS = [
  "pix",
  "dinheiro",
  "debito",
  "credito",
  "credito_parcelado",
  "a_receber",
];

// Atores
let dona: string;
let donaId: string;
let recepcao: string;
let recepcaoId: string;
let profissional: string;
let profissionalId: string;
let recepcaoInativa: string;

// Fixtures
let cli: string;
let outraCliente: string;
let servicoId: string;
let caixaOntem: string; // caixa de ontem, ainda aberto (esquecido)

/** Troca o usuário logado dentro da transação atual (tests.logar_como). */
async function logarComo(c: PoolClient, uid: string) {
  await c.query("set local role authenticated");
  await c.query("select set_config('request.jwt.claims', $1, true)", [
    JSON.stringify({ sub: uid, role: "authenticated" }),
  ]);
}

/** Espera o erro sem abortar a transação (savepoint). */
async function falha(
  c: PoolClient,
  sql: string,
  params: unknown[],
  sqlstate: string,
) {
  await c.query("savepoint tentativa");
  const erro = await esperarErroSql(c.query(sql, params), sqlstate);
  await c.query("rollback to savepoint tentativa");
  return erro;
}

type NovoPagamento = {
  cliente?: string;
  agendamento?: string | null;
  forma: string;
  valor: number;
  desconto?: number | null;
  parcelas?: number | null;
  vencimentos?: string[] | null;
  valores?: number[] | null;
};

const SQL_REGISTRAR =
  "select registrar_pagamento($1, $2, $3::forma_pagamento, $4, $5, $6, $7::date[], $8::int[]) as id";

function paramsPagamento(p: NovoPagamento): unknown[] {
  return [
    p.cliente ?? cli,
    p.agendamento ?? null,
    p.forma,
    p.valor,
    p.desconto === undefined ? 0 : p.desconto,
    p.parcelas === undefined ? 1 : p.parcelas,
    p.vencimentos ?? null,
    p.valores ?? null,
  ];
}

async function registrar(c: PoolClient, p: NovoPagamento): Promise<string> {
  const r = await c.query<{ id: string }>(SQL_REGISTRAR, paramsPagamento(p));
  return r.rows[0].id;
}

function registrarFalha(c: PoolClient, p: NovoPagamento, sqlstate = "P0001") {
  return falha(c, SQL_REGISTRAR, paramsPagamento(p), sqlstate);
}

async function abrir(c: PoolClient, valor: number): Promise<string> {
  const r = await c.query<{ id: string }>("select abrir_caixa($1) as id", [
    valor,
  ]);
  return r.rows[0].id;
}

async function fechar(c: PoolClient, caixa: string, contado: number) {
  const r = await c.query<{ r: Record<string, unknown> }>(
    "select fechar_caixa($1, $2) as r",
    [caixa, contado],
  );
  return r.rows[0].r;
}

beforeAll(async () => {
  await resetarBanco();
  const fe = await criarUsuario("dona", { nome: "Fê" });
  dona = fe.uid;
  donaId = fe.colaboradorId;
  const rec = await criarUsuario("recepcao");
  recepcao = rec.uid;
  recepcaoId = rec.colaboradorId;
  const prof = await criarUsuario("profissional");
  profissional = prof.uid;
  profissionalId = prof.colaboradorId;
  recepcaoInativa = (await criarUsuario("recepcao", { ativo: false })).uid;

  await comoSuperusuario(async (c) => {
    const cliente = async (nome: string) =>
      (
        await c.query<{ id: string }>(
          "insert into clientes (nome, aceite_lgpd_em) values ($1, now()) returning id",
          [nome],
        )
      ).rows[0].id;
    cli = await cliente("Cliente do caixa");
    outraCliente = await cliente("Outra cliente");
    const cat = await c.query<{ id: string }>(
      "insert into categorias_servico (nome) values ('Facial') returning id",
    );
    servicoId = (
      await c.query<{ id: string }>(
        `insert into servicos (nome, categoria_id, duracao_min, preco_centavos)
         values ('Peeling', $1, 60, 25000) returning id`,
        [cat.rows[0].id],
      )
    ).rows[0].id;
    caixaOntem = (
      await c.query<{ id: string }>(
        `insert into caixas (data, aberto_por, valor_inicial_centavos)
         values (${HOJE} - 1, $1, 2000) returning id`,
        [recepcaoId],
      )
    ).rows[0].id;
    // Pagamento de ontem (dinheiro 3000 com 500 de desconto; pix 1000).
    await inserirPagamentoDireto(c, {
      caixaId: caixaOntem,
      clienteId: cli,
      origem: "venda_produto",
      forma: "dinheiro",
      valor: 3000,
      desconto: 500,
      lancadoPor: recepcaoId,
    });
    await inserirPagamentoDireto(c, {
      caixaId: caixaOntem,
      clienteId: cli,
      origem: "venda_produto",
      forma: "pix",
      valor: 1000,
      lancadoPor: recepcaoId,
    });
  });
});

afterAll(fecharConexoes);

describe("estrutura", () => {
  it("enums forma_pagamento e origem_pagamento", async () => {
    const r = await comoSuperusuario((c) =>
      c.query<{ tipo: string; valores: string[] }>(
        `select t.typname as tipo, array_agg(e.enumlabel::text order by e.enumsortorder) as valores
         from pg_type t join pg_enum e on e.enumtypid = t.oid
         where t.typnamespace = 'public'::regnamespace
           and t.typname in ('forma_pagamento', 'origem_pagamento')
         group by t.typname order by t.typname`,
      ),
    );
    expect(r.rows).toEqual([
      { tipo: "forma_pagamento", valores: FORMAS },
      {
        tipo: "origem_pagamento",
        valores: ["agendamento", "pacote", "venda_produto"],
      },
    ]);
  });

  it("colunas das tabelas caixas, pagamentos e contas_receber", async () => {
    const r = await comoSuperusuario((c) =>
      c.query<{ table_name: string; colunas: string[] }>(
        `select table_name, array_agg(column_name::text order by column_name) as colunas
         from information_schema.columns
         where table_schema = 'public'
           and table_name in ('caixas', 'pagamentos', 'contas_receber')
         group by table_name order by table_name`,
      ),
    );
    expect(r.rows).toEqual([
      {
        table_name: "caixas",
        colunas: [
          "aberto_em",
          "aberto_por",
          "atualizado_em",
          "criado_em",
          "data",
          "diferenca_centavos",
          "fechado_em",
          "fechado_por",
          "id",
          "valor_contado_centavos",
          "valor_inicial_centavos",
        ],
      },
      {
        table_name: "contas_receber",
        colunas: [
          "atualizado_em",
          "cancelada_em",
          "cancelada_motivo",
          "cancelada_por",
          "cliente_id",
          "criado_em",
          "descricao",
          "id",
          "lancada_por",
          "numero",
          "origem_manual",
          "pagamento_id",
          "recebido_em",
          "total_parcelas",
          "valor_centavos",
          "vencimento",
        ],
      },
      {
        table_name: "pagamentos",
        colunas: [
          "agendamento_id",
          "atualizado_em",
          "caixa_id",
          "cliente_id",
          "cobranca_id",
          "criado_em",
          "desconto_centavos",
          "forma",
          "id",
          "lancado_por",
          "origem",
          "parcelas",
          "valor_centavos",
        ],
      },
    ]);
  });

  it("caixas.data é única e pagamentos.parcelas tem padrão 1", async () => {
    const r = await comoSuperusuario(async (c) => {
      const unico = await c.query(
        `select 1 from pg_constraint
         where conrelid = 'public.caixas'::regclass and contype = 'u'
           and pg_get_constraintdef(oid) = 'UNIQUE (data)'`,
      );
      const padrao = await c.query<{ d: string }>(
        `select column_default d from information_schema.columns
         where table_schema = 'public' and table_name = 'pagamentos' and column_name = 'parcelas'`,
      );
      return { unico: unico.rowCount, padrao: padrao.rows[0].d };
    });
    expect(r.unico).toBe(1);
    expect(r.padrao).toBe("1");
  });

  it("RLS habilitado nas três tabelas", async () => {
    const r = await comoSuperusuario((c) =>
      c.query<{ relname: string; relrowsecurity: boolean }>(
        `select relname, relrowsecurity from pg_class
         where oid in ('public.caixas'::regclass, 'public.pagamentos'::regclass, 'public.contas_receber'::regclass)
         order by relname`,
      ),
    );
    expect(r.rows.every((l) => l.relrowsecurity)).toBe(true);
    expect(r.rows).toHaveLength(3);
  });

  it("nenhuma política de insert/update/delete nas três tabelas", async () => {
    const r = await comoSuperusuario((c) =>
      c.query<{ tablename: string; cmd: string; roles: string[] }>(
        `select tablename, cmd, roles::text[] as roles from pg_policies
         where schemaname = 'public'
           and tablename in ('caixas', 'pagamentos', 'contas_receber')
         order by tablename`,
      ),
    );
    expect(r.rows).toEqual([
      { tablename: "caixas", cmd: "SELECT", roles: ["authenticated"] },
      { tablename: "contas_receber", cmd: "SELECT", roles: ["authenticated"] },
      { tablename: "pagamentos", cmd: "SELECT", roles: ["authenticated"] },
    ]);
  });

  it("funções de escrita são security definer com search_path vazio", async () => {
    const r = await comoSuperusuario((c) =>
      c.query<{ proname: string; prosecdef: boolean; proconfig: string[] }>(
        `select proname, prosecdef, proconfig from pg_proc
         where pronamespace = 'public'::regnamespace
           and proname in ('abrir_caixa', 'registrar_pagamento', 'fechar_caixa',
                           'agendamentos_sem_pagamento', 'caixa_aberto_hoje_id')
         order by proname`,
      ),
    );
    expect(r.rows.map((l) => l.proname)).toEqual([
      "abrir_caixa",
      "agendamentos_sem_pagamento",
      "caixa_aberto_hoje_id",
      "fechar_caixa",
      "registrar_pagamento",
    ]);
    for (const l of r.rows) {
      expect(l.prosecdef, l.proname).toBe(true);
      expect(l.proconfig, l.proname).toEqual(['search_path=""']);
    }
  });

  it("anônimo não executa nenhuma função do caixa (42501)", async () => {
    const chamadas = [
      "select abrir_caixa(0)",
      `select registrar_pagamento(gen_random_uuid(), null, 'pix', 1, 0, 1, null, null)`,
      "select fechar_caixa(gen_random_uuid(), 0)",
      "select caixa_de_hoje()",
      "select agendamentos_sem_pagamento(current_date)",
      "select caixa_aberto_hoje_id()",
    ];
    for (const sql of chamadas) {
      await comoUsuario(null, (c) => esperarErroSql(c.query(sql), "42501"));
    }
  });
});

describe("fluxo do caixa do dia (cenário do plano, 1:1)", () => {
  it("abre, lança, parcela a receber, fecha e esconde da recepção", async () => {
    await comoUsuario(recepcao, async (c) => {
      // Ontem ainda está aberto, mas não serve: só o caixa de hoje recebe.
      const semCaixa = await registrarFalha(c, { forma: "pix", valor: 10000 });
      expect(semCaixa.message).toBe(MSG_ABRA_O_CAIXA);

      const caixa = await abrir(c, 5000);

      const duplicado = await falha(c, "select abrir_caixa(5000)", [], "P0001");
      expect(duplicado.message).toBe(MSG_JA_EXISTE);

      await c.query(
        "select registrar_pagamento($1, null, 'dinheiro', 8000, 0, 1, null, null)",
        [cli],
      );
      await c.query(
        `select registrar_pagamento($1, null, 'a_receber', 10000, 0, 3,
           array['2026-12-03','2027-01-03','2027-02-03']::date[], array[3334,3333,3333])`,
        [cli],
      );
      await falha(
        c,
        `select registrar_pagamento($1, null, 'a_receber', 10000, 0, 2,
           array['2026-12-03','2027-01-03']::date[], array[5000,4000])`,
        [cli],
        "P0001",
      );

      expect(await contar(c, "contas_receber"), "recepção não vê contas a receber").toBe(0);

      const resumo = await fechar(c, caixa, 13000);
      expect(Number(resumo.dinheiro_esperado)).toBe(13000);

      expect(
        await contar(c, "pagamentos"),
        "recepção não vê pagamentos de caixa fechado",
      ).toBe(0);

      await falha(c, "select fechar_caixa($1, 13000)", [caixa], "P0001");

      await logarComo(c, dona);
      expect(await contar(c, "contas_receber")).toBe(3);

      await logarComo(c, profissional);
      await falha(c, "select abrir_caixa(0)", [], "P0001");
      await falha(
        c,
        `insert into pagamentos (caixa_id, cliente_id, origem, forma, valor_centavos, lancado_por)
         values ($1, $2, 'venda_produto', 'pix', 100, $3)`,
        [caixa, cli, profissionalId],
        "42501",
      );
    });
  });
});

describe("abrir_caixa", () => {
  it("grava data de hoje (São Paulo), quem abriu e valor inicial", async () => {
    const r = await comoUsuario(recepcao, async (c) => {
      const id = await abrir(c, 5000);
      return c.query(
        `select (data = ${HOJE}) as hoje, aberto_por, valor_inicial_centavos,
                aberto_em is not null as aberto, fechado_em, fechado_por,
                valor_contado_centavos, diferenca_centavos
         from caixas where id = $1`,
        [id],
      );
    });
    expect(r.rows[0]).toEqual({
      hoje: true,
      aberto_por: recepcaoId,
      valor_inicial_centavos: 5000,
      aberto: true,
      fechado_em: null,
      fechado_por: null,
      valor_contado_centavos: null,
      diferenca_centavos: null,
    });
  });

  it("dona abre o caixa; valor inicial zero é permitido", async () => {
    await comoUsuario(dona, (c) => abrir(c, 0));
  });

  it("caixa de hoje já fechado também bloqueia novo caixa", async () => {
    await comoUsuario(recepcao, async (c) => {
      const id = await abrir(c, 0);
      await fechar(c, id, 0);
      const e = await falha(c, "select abrir_caixa(0)", [], "P0001");
      expect(e.message).toBe(MSG_JA_EXISTE);
    });
  });

  it("valor inicial negativo ou nulo é rejeitado (P0001)", async () => {
    await comoUsuario(recepcao, async (c) => {
      await falha(c, "select abrir_caixa(-1)", [], "P0001");
      await falha(c, "select abrir_caixa(null)", [], "P0001");
    });
  });

  it.each([
    ["profissional", () => profissional],
    ["recepção inativa", () => recepcaoInativa],
  ] as const)("%s não abre caixa (P0001)", async (_n, uid) => {
    await comoUsuario(uid(), (c) =>
      esperarErroSql(c.query("select abrir_caixa(0)"), "P0001"),
    );
  });
});

describe("registrar_pagamento", () => {
  it("grava caixa de hoje, origem, lançado_por e valores", async () => {
    const r = await comoUsuario(recepcao, async (c) => {
      const caixa = await abrir(c, 0);
      const id = await registrar(c, {
        forma: "pix",
        valor: 12000,
        desconto: 1500,
      });
      const p = await c.query(
        `select caixa_id = $2 as no_caixa, cliente_id, agendamento_id, origem, forma,
                parcelas, valor_centavos, desconto_centavos, lancado_por
         from pagamentos where id = $1`,
        [id, caixa],
      );
      return p.rows[0];
    });
    expect(r).toEqual({
      no_caixa: true,
      cliente_id: cli,
      agendamento_id: null,
      origem: "venda_produto",
      forma: "pix",
      parcelas: 1,
      valor_centavos: 12000,
      desconto_centavos: 1500,
      lancado_por: recepcaoId,
    });
  });

  it("pagamento de agendamento grava origem 'agendamento'", async () => {
    const r = await comoUsuario(dona, async (c) => {
      await abrir(c, 0);
      const ag = await c.query<{ id: string }>(
        `insert into agendamentos (cliente_id, profissional_id, servico_id, inicio, fim, status)
         values ($1, $2, $3, '2030-02-01T10:00:00-03:00', '2030-02-01T11:00:00-03:00', 'atendido')
         returning id`,
        [cli, profissionalId, servicoId],
      );
      const id = await registrar(c, {
        agendamento: ag.rows[0].id,
        forma: "debito",
        valor: 25000,
      });
      const p = await c.query(
        "select origem, agendamento_id = $2 as ag, lancado_por from pagamentos where id = $1",
        [id, ag.rows[0].id],
      );
      return p.rows[0];
    });
    expect(r).toEqual({ origem: "agendamento", ag: true, lancado_por: donaId });
  });

  it("agendamento de outra cliente ou inexistente é rejeitado (P0001)", async () => {
    await comoUsuario(dona, async (c) => {
      await abrir(c, 0);
      const ag = await c.query<{ id: string }>(
        `insert into agendamentos (cliente_id, profissional_id, servico_id, inicio, fim, status)
         values ($1, $2, $3, '2030-02-02T10:00:00-03:00', '2030-02-02T11:00:00-03:00', 'atendido')
         returning id`,
        [outraCliente, profissionalId, servicoId],
      );
      await registrarFalha(c, {
        agendamento: ag.rows[0].id,
        forma: "pix",
        valor: 100,
      });
      await registrarFalha(c, {
        agendamento: "00000000-0000-0000-0000-000000000000",
        forma: "pix",
        valor: 100,
      });
    });
  });

  it("cliente inexistente ou nula é rejeitada (P0001)", async () => {
    await comoUsuario(recepcao, async (c) => {
      await abrir(c, 0);
      await registrarFalha(c, {
        cliente: "00000000-0000-0000-0000-000000000000",
        forma: "pix",
        valor: 100,
      });
      await falha(
        c,
        "select registrar_pagamento(null, null, 'pix', 100, 0, 1, null, null)",
        [],
        "P0001",
      );
    });
  });

  it("caixa de hoje fechado não recebe pagamentos", async () => {
    await comoUsuario(recepcao, async (c) => {
      const caixa = await abrir(c, 0);
      await fechar(c, caixa, 0);
      const e = await registrarFalha(c, { forma: "pix", valor: 100 });
      expect(e.message).toBe(MSG_ABRA_O_CAIXA);
    });
  });

  const invalidos: [string, NovoPagamento][] = [
    ["valor zero", { forma: "pix", valor: 0 }],
    ["valor negativo", { forma: "pix", valor: -100 }],
    ["desconto negativo", { forma: "pix", valor: 100, desconto: -1 }],
    ["desconto maior que o valor", { forma: "pix", valor: 100, desconto: 101 }],
    ["parcelas zero", { forma: "credito_parcelado", valor: 100, parcelas: 0 }],
    ["parcelas negativas", { forma: "a_receber", valor: 100, parcelas: -1 }],
    ["pix em 2 parcelas", { forma: "pix", valor: 100, parcelas: 2 }],
    ["dinheiro em 2 parcelas", { forma: "dinheiro", valor: 100, parcelas: 2 }],
    ["débito em 2 parcelas", { forma: "debito", valor: 100, parcelas: 2 }],
    ["crédito à vista em 2 parcelas", { forma: "credito", valor: 100, parcelas: 2 }],
    [
      "a receber sem vencimentos",
      { forma: "a_receber", valor: 100, parcelas: 1, valores: [100] },
    ],
    [
      "a receber sem valores",
      { forma: "a_receber", valor: 100, parcelas: 1, vencimentos: ["2027-01-01"] },
    ],
    [
      "a receber com menos vencimentos que parcelas",
      {
        forma: "a_receber",
        valor: 100,
        parcelas: 2,
        vencimentos: ["2027-01-01"],
        valores: [50, 50],
      },
    ],
    [
      "a receber com mais valores que parcelas",
      {
        forma: "a_receber",
        valor: 100,
        parcelas: 2,
        vencimentos: ["2027-01-01", "2027-02-01"],
        valores: [50, 25, 25],
      },
    ],
    [
      "a receber com soma maior que o total",
      {
        forma: "a_receber",
        valor: 10000,
        parcelas: 3,
        vencimentos: ["2026-12-03", "2027-01-03", "2027-02-03"],
        valores: [3334, 3334, 3333],
      },
    ],
    [
      "a receber com soma ignorando o desconto",
      {
        forma: "a_receber",
        valor: 10000,
        desconto: 1000,
        parcelas: 2,
        vencimentos: ["2026-12-03", "2027-01-03"],
        valores: [5000, 5000],
      },
    ],
    [
      "a receber com parcela zero",
      {
        forma: "a_receber",
        valor: 100,
        parcelas: 2,
        vencimentos: ["2027-01-01", "2027-02-01"],
        valores: [100, 0],
      },
    ],
    [
      "a receber com parcela negativa",
      {
        forma: "a_receber",
        valor: 100,
        parcelas: 2,
        vencimentos: ["2027-01-01", "2027-02-01"],
        valores: [150, -50],
      },
    ],
  ];
  it.each(invalidos)("rejeita %s (P0001)", async (_nome, p) => {
    await comoUsuario(recepcao, async (c) => {
      await abrir(c, 0);
      await registrarFalha(c, p);
      expect(await contar(c, "pagamentos")).toBe(0);
    });
  });

  it("a receber com vencimento ou valor nulo é rejeitado (P0001)", async () => {
    await comoUsuario(recepcao, async (c) => {
      await abrir(c, 0);
      await falha(
        c,
        `select registrar_pagamento($1, null, 'a_receber', 100, 0, 2,
           array['2027-01-01', null]::date[], array[50, 50])`,
        [cli],
        "P0001",
      );
      await falha(
        c,
        `select registrar_pagamento($1, null, 'a_receber', 100, 0, 2,
           array['2027-01-01', '2027-02-01']::date[], array[100, null]::int[])`,
        [cli],
        "P0001",
      );
    });
  });

  it("forma nula ou valor nulo é rejeitado (P0001)", async () => {
    await comoUsuario(recepcao, async (c) => {
      await abrir(c, 0);
      await falha(
        c,
        "select registrar_pagamento($1, null, null, 100, 0, 1, null, null)",
        [cli],
        "P0001",
      );
      await falha(
        c,
        "select registrar_pagamento($1, null, 'pix', null, 0, 1, null, null)",
        [cli],
        "P0001",
      );
    });
  });

  it("desconto igual ao valor é permitido (cortesia)", async () => {
    await comoUsuario(recepcao, async (c) => {
      await abrir(c, 0);
      await registrar(c, { forma: "pix", valor: 100, desconto: 100 });
    });
  });

  it("desconto e parcelas nulos valem 0 e 1", async () => {
    const r = await comoUsuario(recepcao, async (c) => {
      await abrir(c, 0);
      const id = await registrar(c, {
        forma: "dinheiro",
        valor: 100,
        desconto: null,
        parcelas: null,
      });
      return (
        await c.query(
          "select desconto_centavos, parcelas from pagamentos where id = $1",
          [id],
        )
      ).rows[0];
    });
    expect(r).toEqual({ desconto_centavos: 0, parcelas: 1 });
  });

  it("a receber gera uma conta por parcela, com desconto aplicado", async () => {
    const r = await comoUsuario(recepcao, async (c) => {
      await abrir(c, 0);
      const id = await registrar(c, {
        forma: "a_receber",
        valor: 10000,
        desconto: 1000,
        parcelas: 2,
        vencimentos: ["2026-12-10", "2027-01-10"],
        valores: [4500, 4500],
      });
      await logarComo(c, dona);
      const contas = await c.query(
        `select cliente_id, pagamento_id = $1 as do_pagamento, numero, total_parcelas,
                valor_centavos, to_char(vencimento, 'YYYY-MM-DD') as vencimento, recebido_em
         from contas_receber order by numero`,
        [id],
      );
      const p = await c.query(
        "select parcelas, forma from pagamentos where id = $1",
        [id],
      );
      return { contas: contas.rows, pagamento: p.rows[0] };
    });
    expect(r.pagamento).toEqual({ parcelas: 2, forma: "a_receber" });
    expect(r.contas).toEqual([
      {
        cliente_id: cli,
        do_pagamento: true,
        numero: 1,
        total_parcelas: 2,
        valor_centavos: 4500,
        vencimento: "2026-12-10",
        recebido_em: null,
      },
      {
        cliente_id: cli,
        do_pagamento: true,
        numero: 2,
        total_parcelas: 2,
        valor_centavos: 4500,
        vencimento: "2027-01-10",
        recebido_em: null,
      },
    ]);
  });

  it("R$ 100,00 em 3x a receber: parcelas somam exatamente o total (Review Focus 5)", async () => {
    const r = await comoUsuario(recepcao, async (c) => {
      await abrir(c, 0);
      await registrar(c, {
        forma: "a_receber",
        valor: 10000,
        parcelas: 3,
        vencimentos: ["2026-12-03", "2027-01-03", "2027-02-03"],
        valores: [3334, 3333, 3333],
      });
      await logarComo(c, dona);
      return (
        await c.query<{ soma: number; n: number }>(
          "select sum(valor_centavos)::int soma, count(*)::int n from contas_receber",
        )
      ).rows[0];
    });
    expect(r).toEqual({ soma: 10000, n: 3 });
  });

  it("crédito parcelado guarda as parcelas e não gera contas a receber", async () => {
    const r = await comoUsuario(recepcao, async (c) => {
      await abrir(c, 0);
      const id = await registrar(c, {
        forma: "credito_parcelado",
        valor: 30000,
        parcelas: 3,
        // ignorados fora de "a receber"
        vencimentos: ["2027-01-01"],
        valores: [1],
      });
      await logarComo(c, dona);
      return {
        parcelas: (
          await c.query<{ parcelas: number }>(
            "select parcelas from pagamentos where id = $1",
            [id],
          )
        ).rows[0].parcelas,
        contas: await contar(c, "contas_receber"),
      };
    });
    expect(r).toEqual({ parcelas: 3, contas: 0 });
  });

  it("formas à vista ignoram vencimentos e valores de parcelas", async () => {
    const contas = await comoUsuario(recepcao, async (c) => {
      await abrir(c, 0);
      await registrar(c, {
        forma: "pix",
        valor: 100,
        vencimentos: ["2027-01-01", "2027-02-01"],
        valores: [1, 2],
      });
      await logarComo(c, dona);
      return contar(c, "contas_receber");
    });
    expect(contas).toBe(0);
  });

  it("segundo pagamento para o mesmo agendamento é rejeitado (0005: pagamento único, 23505)", async () => {
    await comoUsuario(recepcao, async (c) => {
      await abrir(c, 0);
      const ag = await c.query<{ id: string }>(
        `insert into agendamentos (cliente_id, profissional_id, servico_id, inicio, fim, status)
         values ($1, $2, $3, '2030-02-03T10:00:00-03:00', '2030-02-03T11:00:00-03:00', 'atendido')
         returning id`,
        [cli, profissionalId, servicoId],
      );
      await registrar(c, { agendamento: ag.rows[0].id, forma: "pix", valor: 10000 });
      await registrarFalha(
        c,
        { agendamento: ag.rows[0].id, forma: "dinheiro", valor: 15000 },
        "23505",
      );
      expect(await contar(c, "pagamentos")).toBe(1);
    });
  });

  it.each([
    ["profissional", () => profissional],
    ["recepção inativa", () => recepcaoInativa],
  ] as const)("%s não lança pagamento mesmo com caixa aberto (P0001)", async (_n, uid) => {
    await comoUsuario(recepcao, async (c) => {
      await abrir(c, 0);
      await logarComo(c, uid());
      await registrarFalha(c, { forma: "pix", valor: 100 });
    });
  });
});

describe("fechar_caixa", () => {
  it("totais por forma líquidos de desconto, dinheiro esperado e diferença", async () => {
    const r = await comoUsuario(recepcao, async (c) => {
      const caixa = await abrir(c, 5000);
      await registrar(c, { forma: "dinheiro", valor: 8000, desconto: 500 });
      await registrar(c, { forma: "pix", valor: 12000 });
      await registrar(c, { forma: "credito_parcelado", valor: 30000, parcelas: 3 });
      await registrar(c, {
        forma: "a_receber",
        valor: 10000,
        desconto: 1000,
        parcelas: 1,
        vencimentos: ["2027-01-10"],
        valores: [9000],
      });
      const resumo = await fechar(c, caixa, 12000);
      await logarComo(c, dona);
      const linha = await c.query(
        `select fechado_por, fechado_em is not null as fechado,
                valor_contado_centavos, diferenca_centavos
         from caixas where id = $1`,
        [caixa],
      );
      return { resumo, linha: linha.rows[0] };
    });
    expect(r.resumo).toEqual({
      total_por_forma: {
        pix: 12000,
        dinheiro: 7500,
        debito: 0,
        credito: 0,
        credito_parcelado: 30000,
        // 0010: 'a_receber' só entra no caixa quando a parcela é recebida.
        a_receber: 0,
      },
      total_geral: 49500,
      dinheiro_esperado: 12500,
      diferenca: -500,
    });
    expect(r.linha).toEqual({
      fechado_por: recepcaoId,
      fechado: true,
      valor_contado_centavos: 12000,
      diferenca_centavos: -500,
    });
  });

  it("caixa sem lançamentos: tudo zero, sobra registrada como diferença positiva", async () => {
    const resumo = await comoUsuario(recepcao, async (c) => {
      const caixa = await abrir(c, 1000);
      return fechar(c, caixa, 1250);
    });
    expect(resumo).toEqual({
      total_por_forma: Object.fromEntries(FORMAS.map((f) => [f, 0])),
      total_geral: 0,
      dinheiro_esperado: 1000,
      diferenca: 250,
    });
  });

  it("já fechado: erro com mensagem clara", async () => {
    await comoUsuario(recepcao, async (c) => {
      const caixa = await abrir(c, 0);
      await fechar(c, caixa, 0);
      const e = await falha(c, "select fechar_caixa($1, 0)", [caixa], "P0001");
      expect(e.message).toBe("Este caixa já foi fechado");
    });
  });

  it("dona fecha o caixa de ontem com os totais de ontem", async () => {
    const resumo = await comoUsuario(dona, (c) => fechar(c, caixaOntem, 4500));
    expect(resumo).toEqual({
      total_por_forma: { ...Object.fromEntries(FORMAS.map((f) => [f, 0])), dinheiro: 2500, pix: 1000 },
      total_geral: 3500,
      dinheiro_esperado: 4500,
      diferenca: 0,
    });
  });

  it("recepção não fecha caixa de outro dia (P0001)", async () => {
    await comoUsuario(recepcao, (c) =>
      esperarErroSql(c.query("select fechar_caixa($1, 0)", [caixaOntem]), "P0001"),
    );
    const aberto = await comoSuperusuario(
      async (c) =>
        (
          await c.query<{ aberto: boolean }>(
            "select fechado_em is null as aberto from caixas where id = $1",
            [caixaOntem],
          )
        ).rows[0].aberto,
    );
    expect(aberto).toBe(true);
  });

  it("caixa inexistente (P0001)", async () => {
    await comoUsuario(dona, (c) =>
      esperarErroSql(
        c.query("select fechar_caixa(gen_random_uuid(), 0)"),
        "P0001",
      ),
    );
  });

  it("valor contado negativo ou nulo é rejeitado (P0001)", async () => {
    await comoUsuario(recepcao, async (c) => {
      const caixa = await abrir(c, 0);
      await falha(c, "select fechar_caixa($1, -1)", [caixa], "P0001");
      await falha(c, "select fechar_caixa($1, null)", [caixa], "P0001");
    });
  });

  it.each([
    ["profissional", () => profissional],
    ["recepção inativa", () => recepcaoInativa],
  ] as const)("%s não fecha caixa (P0001)", async (_n, uid) => {
    await comoUsuario(recepcao, async (c) => {
      const caixa = await abrir(c, 0);
      await logarComo(c, uid());
      await falha(c, "select fechar_caixa($1, 0)", [caixa], "P0001");
    });
  });
});

describe("caixa_de_hoje", () => {
  it("nulo quando não há caixa hoje", async () => {
    const r = await comoUsuario(recepcao, (c) =>
      c.query<{ vazio: boolean }>("select caixa_de_hoje() is null as vazio"),
    );
    expect(r.rows[0].vazio).toBe(true);
  });

  it("recepção recebe o caixa aberto; depois de fechado, nulo; dona continua vendo", async () => {
    const r = await comoUsuario(recepcao, async (c) => {
      const caixa = await abrir(c, 700);
      const aberto = await c.query<{ id: string; valor: number }>(
        "select (caixa_de_hoje()).id, (caixa_de_hoje()).valor_inicial_centavos as valor",
      );
      await fechar(c, caixa, 700);
      const recepcaoDepois = await c.query<{ vazio: boolean }>(
        "select caixa_de_hoje() is null as vazio",
      );
      await logarComo(c, dona);
      const donaDepois = await c.query<{ id: string }>(
        "select (caixa_de_hoje()).id",
      );
      await logarComo(c, profissional);
      const prof = await c.query<{ vazio: boolean }>(
        "select caixa_de_hoje() is null as vazio",
      );
      return {
        caixa,
        aberto: aberto.rows[0],
        recepcaoDepois: recepcaoDepois.rows[0].vazio,
        donaDepois: donaDepois.rows[0].id,
        prof: prof.rows[0].vazio,
      };
    });
    expect(r.aberto).toEqual({ id: r.caixa, valor: 700 });
    expect(r.recepcaoDepois).toBe(true);
    expect(r.donaDepois).toBe(r.caixa);
    expect(r.prof).toBe(true);
  });
});

describe("visibilidade (RLS select)", () => {
  it("recepção vê só o caixa de hoje aberto e os pagamentos dele", async () => {
    const r = await comoUsuario(recepcao, async (c) => {
      const antes = {
        caixas: await contar(c, "caixas"),
        pagamentos: await contar(c, "pagamentos"),
      };
      const caixa = await abrir(c, 0);
      await registrar(c, { forma: "pix", valor: 100 });
      await registrar(c, { forma: "dinheiro", valor: 200 });
      const aberto = {
        caixas: (await c.query<{ id: string }>("select id from caixas")).rows.map(
          (l) => l.id,
        ),
        pagamentos: await contar(c, "pagamentos"),
      };
      return { antes, aberto, caixa };
    });
    // O caixa de ontem (aberto) e os pagamentos dele ficam invisíveis.
    expect(r.antes).toEqual({ caixas: 0, pagamentos: 0 });
    expect(r.aberto).toEqual({ caixas: [r.caixa], pagamentos: 2 });
  });

  it("dona vê todos os caixas, pagamentos e contas a receber", async () => {
    const r = await comoUsuario(recepcao, async (c) => {
      await abrir(c, 0);
      await registrar(c, {
        forma: "a_receber",
        valor: 100,
        parcelas: 1,
        vencimentos: ["2027-01-01"],
        valores: [100],
      });
      await logarComo(c, dona);
      return [
        await contar(c, "caixas"),
        await contar(c, "pagamentos"),
        await contar(c, "contas_receber"),
      ];
    });
    expect(r).toEqual([2, 3, 1]);
  });

  it.each([
    ["profissional", () => profissional],
    ["recepção inativa", () => recepcaoInativa],
  ] as const)("%s não vê nada nas três tabelas", async (_n, uid) => {
    const r = await comoUsuario(recepcao, async (c) => {
      await abrir(c, 0);
      await registrar(c, {
        forma: "a_receber",
        valor: 100,
        parcelas: 1,
        vencimentos: ["2027-01-01"],
        valores: [100],
      });
      await logarComo(c, uid());
      return [
        await contar(c, "caixas"),
        await contar(c, "pagamentos"),
        await contar(c, "contas_receber"),
      ];
    });
    expect(r).toEqual([0, 0, 0]);
  });

  it.each(["caixas", "pagamentos", "contas_receber"])(
    "anônimo não lê %s (42501)",
    async (tabela) => {
      await comoUsuario(null, (c) =>
        esperarErroSql(c.query(`select * from ${tabela}`), "42501"),
      );
    },
  );
});

describe("escrita direta negada para todos (42501)", () => {
  const atores: [string, () => string][] = [
    ["dona", () => dona],
    ["recepcao", () => recepcao],
    ["profissional", () => profissional],
  ];

  describe.each(atores)("%s", (_nome, uid) => {
    it("insert em caixas", async () => {
      await comoUsuario(uid(), (c) =>
        esperarErroSql(
          c.query(
            `insert into caixas (data, aberto_por, valor_inicial_centavos)
             values (${HOJE} + 10, $1, 0)`,
            [recepcaoId],
          ),
          "42501",
        ),
      );
    });

    it("insert em pagamentos", async () => {
      await comoUsuario(uid(), (c) =>
        esperarErroSql(
          c.query(
            `insert into pagamentos (caixa_id, cliente_id, origem, forma, valor_centavos, lancado_por)
             values ($1, $2, 'venda_produto', 'pix', 100, $3)`,
            [caixaOntem, cli, recepcaoId],
          ),
          "42501",
        ),
      );
    });

    it("insert em contas_receber", async () => {
      await comoUsuario(uid(), (c) =>
        esperarErroSql(
          c.query(
            `insert into contas_receber (cliente_id, pagamento_id, numero, total_parcelas, valor_centavos, vencimento)
             values ($1, gen_random_uuid(), 1, 1, 100, '2027-01-01')`,
            [cli],
          ),
          "42501",
        ),
      );
    });

    it.each([
      "update caixas set valor_inicial_centavos = 0",
      "update pagamentos set valor_centavos = 1",
      "update contas_receber set recebido_em = now()",
      "delete from caixas",
      "delete from pagamentos",
      "delete from contas_receber",
    ])("%s", async (sql) => {
      await comoUsuario(uid(), (c) => esperarErroSql(c.query(sql), "42501"));
    });
  });

  it("nada foi alterado", async () => {
    const r = await comoSuperusuario(async (c) => [
      await contar(c, "caixas"),
      await contar(c, "pagamentos"),
    ]);
    expect(r).toEqual([1, 2]);
  });
});

describe("agendamentos_sem_pagamento", () => {
  const DIA = "2030-03-04";
  let atendidoSemPagamento: string;
  let atendidoPago: string;
  let atendidoPacote: string;
  let atendidoMeiaNoite: string; // 23:30 do dia (02:30 UTC do dia seguinte)

  beforeAll(async () => {
    await comoSuperusuario(async (c) => {
      const ag = async (inicio: string, fim: string, status: string, extra = "") => {
        const pacote = extra
          ? await criarPacote(c, { clienteId: cli, servicoId })
          : null;
        return (
          await c.query<{ id: string }>(
            `insert into agendamentos (cliente_id, profissional_id, servico_id, inicio, fim, status, pacote_vendido_id)
             values ($1, $2, $3, $4, $5, $6, $7) returning id`,
            [cli, profissionalId, servicoId, inicio, fim, status, pacote],
          )
        ).rows[0].id;
      };
      atendidoSemPagamento = await ag(
        `${DIA}T09:00:00-03:00`,
        `${DIA}T10:00:00-03:00`,
        "atendido",
      );
      atendidoPago = await ag(
        `${DIA}T10:00:00-03:00`,
        `${DIA}T11:00:00-03:00`,
        "atendido",
      );
      atendidoPacote = await ag(
        `${DIA}T11:00:00-03:00`,
        `${DIA}T12:00:00-03:00`,
        "atendido",
        "pacote",
      );
      atendidoMeiaNoite = await ag(
        `${DIA}T23:30:00-03:00`,
        "2030-03-05T00:20:00-03:00",
        "atendido",
      );
      // Não atendidos: não entram.
      await ag(`${DIA}T13:00:00-03:00`, `${DIA}T14:00:00-03:00`, "confirmado");
      await ag(`${DIA}T14:00:00-03:00`, `${DIA}T15:00:00-03:00`, "faltou");
      await ag(`${DIA}T15:00:00-03:00`, `${DIA}T16:00:00-03:00`, "cancelado");
      await ag(`${DIA}T16:00:00-03:00`, `${DIA}T17:00:00-03:00`, "pendente");
      // Dia anterior às 23:00 (02:00 UTC do dia): não entra.
      await ag("2030-03-03T23:00:00-03:00", "2030-03-03T23:50:00-03:00", "atendido");
      // Pagamento do atendido, lançado no caixa de ontem.
      await inserirPagamentoDireto(c, {
        caixaId: caixaOntem,
        clienteId: cli,
        origem: "agendamento",
        agendamentoId: atendidoPago,
        forma: "pix",
        valor: 25000,
        lancadoPor: recepcaoId,
      });
    });
  });

  afterAll(async () => {
    await comoSuperusuario(async (c) => {
      await c.query("delete from pagamentos where agendamento_id is not null");
      await c.query("delete from cobrancas where agendamento_id is not null");
      await c.query(
        "delete from agendamentos where inicio >= '2030-03-01' and inicio < '2030-04-01'",
      );
    });
  });

  async function lista(uid: string, dia = DIA): Promise<string[]> {
    const r = await comoUsuario(uid, (c) =>
      c.query<{ id: string }>(
        "select id from agendamentos_sem_pagamento($1::date) as id order by id",
        [dia],
      ),
    );
    return r.rows.map((l) => l.id);
  }

  it.each([
    ["dona", () => dona],
    ["recepcao", () => recepcao],
  ] as const)("%s: atendidos do dia sem pagamento e fora de pacote", async (_n, uid) => {
    expect(await lista(uid())).toEqual(
      [atendidoSemPagamento, atendidoMeiaNoite].sort(),
    );
    expect(await lista(uid())).not.toContain(atendidoPago);
    expect(await lista(uid())).not.toContain(atendidoPacote);
  });

  it("dia sem atendimentos: vazio", async () => {
    expect(await lista(dona, "2030-03-06")).toEqual([]);
  });

  it("ao registrar o pagamento, sai da lista", async () => {
    const r = await comoUsuario(recepcao, async (c) => {
      await abrir(c, 0);
      await registrar(c, {
        agendamento: atendidoSemPagamento,
        forma: "pix",
        valor: 25000,
      });
      return (
        await c.query<{ id: string }>(
          "select id from agendamentos_sem_pagamento($1::date) as id",
          [DIA],
        )
      ).rows.map((l) => l.id);
    });
    expect(r).toEqual([atendidoMeiaNoite]);
  });

  it.each([
    ["profissional", () => profissional],
    ["recepção inativa", () => recepcaoInativa],
  ] as const)("%s: nada", async (_n, uid) => {
    expect(await lista(uid())).toEqual([]);
  });
});

describe("TRUNCATE negado (R11)", () => {
  it.each(["caixas", "pagamentos", "contas_receber", "clientes", "agendamentos", "colaboradores"])(
    "authenticated não trunca %s (42501)",
    async (tabela) => {
      await comoUsuario(dona, (c) =>
        esperarErroSql(c.query(`truncate ${tabela} cascade`), "42501"),
      );
    },
  );

  it("anon não trunca (42501)", async () => {
    await comoUsuario(null, (c) =>
      esperarErroSql(c.query("truncate clientes cascade"), "42501"),
    );
  });

  it("nenhuma tabela pública concede TRUNCATE a anon ou authenticated", async () => {
    const r = await comoSuperusuario((c) =>
      c.query<{ relname: string }>(
        `select relname from pg_class
         where relnamespace = 'public'::regnamespace and relkind in ('r', 'p')
           and (has_table_privilege('anon', oid, 'TRUNCATE')
                or has_table_privilege('authenticated', oid, 'TRUNCATE'))`,
      ),
    );
    expect(r.rows).toEqual([]);
  });

  it("tabelas criadas depois também não concedem TRUNCATE (default privileges)", async () => {
    const r = await comoSuperusuario(async (c) => {
      await c.query("savepoint s");
      await c.query("create table public.tabela_futura (id int)");
      const p = await c.query<{ anon: boolean; auth: boolean; sel: boolean }>(
        `select has_table_privilege('anon', 'public.tabela_futura', 'TRUNCATE') anon,
                has_table_privilege('authenticated', 'public.tabela_futura', 'TRUNCATE') auth,
                has_table_privilege('authenticated', 'public.tabela_futura', 'SELECT') sel`,
      );
      await c.query("rollback to savepoint s");
      return p.rows[0];
    });
    expect(r).toEqual({ anon: false, auth: false, sel: true });
  });
});

describe("tipos de dados", () => {
  it("valores monetários são inteiros (centavos)", async () => {
    const r = await comoSuperusuario((c) =>
      c.query<{ coluna: string; tipo: string }>(
        `select table_name || '.' || column_name as coluna, data_type as tipo
         from information_schema.columns
         where table_schema = 'public'
           and table_name in ('caixas', 'pagamentos', 'contas_receber')
           and column_name like '%centavos'
         order by 1`,
      ),
    );
    expect(r.rows.length).toBe(6);
    for (const l of r.rows) expect(l.tipo, l.coluna).toBe("integer");
  });
});
