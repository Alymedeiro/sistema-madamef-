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
  resetarBanco,
} from "./helpers";

// 0005: pagamento único por atendimento, só de atendimento concluído;
// atendidos sem pagamento num período; aniversariantes filtrados no banco.

const MSG_NAO_CONCLUIDO = "Só é possível lançar pagamento de atendimento concluído.";

let dona: string;
let recepcao: string;
let recepcaoId: string;
let profissional: string;
let profissionalId: string;
let recepcaoInativa: string;
let cli: string;
let servicoId: string;

async function savepoint<T>(c: PoolClient, fn: () => Promise<T>): Promise<T> {
  await c.query("savepoint tentativa");
  try {
    return await fn();
  } finally {
    await c.query("rollback to savepoint tentativa");
  }
}

async function agendamento(
  c: PoolClient,
  inicio: string,
  fim: string,
  status: string,
  pacote = false,
): Promise<string> {
  const pacoteId = pacote
    ? await criarPacote(c, { clienteId: cli, servicoId })
    : null;
  const r = await c.query<{ id: string }>(
    `insert into agendamentos (cliente_id, profissional_id, servico_id, inicio, fim, status, pacote_vendido_id)
     values ($1, $2, $3, $4, $5, $6, $7) returning id`,
    [cli, profissionalId, servicoId, inicio, fim, status, pacoteId],
  );
  return r.rows[0].id;
}

const SQL_PAGAR =
  "select registrar_pagamento($1, $2, 'pix', 10000, 0, 1, null, null) as id";

beforeAll(async () => {
  await resetarBanco();
  dona = (await criarUsuario("dona")).uid;
  const rec = await criarUsuario("recepcao");
  recepcao = rec.uid;
  recepcaoId = rec.colaboradorId;
  const prof = await criarUsuario("profissional");
  profissional = prof.uid;
  profissionalId = prof.colaboradorId;
  recepcaoInativa = (await criarUsuario("recepcao", { ativo: false })).uid;

  await comoSuperusuario(async (c) => {
    cli = (
      await c.query<{ id: string }>(
        "insert into clientes (nome, aceite_lgpd_em) values ('Cliente', now()) returning id",
      )
    ).rows[0].id;
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
  });
});

afterAll(fecharConexoes);

describe("pagamento único por atendimento", () => {
  it("cobrancas_agendamento_unico existe e pagamentos_agendamento_unico não (0007)", async () => {
    const r = await comoSuperusuario((c) =>
      c.query<{ nome: string; def: string }>(
        `select indexname as nome, indexdef as def from pg_indexes
         where schemaname = 'public'
           and indexname in ('cobrancas_agendamento_unico', 'pagamentos_agendamento_unico')`,
      ),
    );
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].nome).toBe("cobrancas_agendamento_unico");
    expect(r.rows[0].def).toMatch(/UNIQUE INDEX/);
    expect(r.rows[0].def).toMatch(/\(agendamento_id\)/);
  });

  it("segundo pagamento do mesmo atendimento falha com 23505", async () => {
    await comoUsuario(recepcao, async (c) => {
      await c.query("select abrir_caixa(0)");
      await comoSuperusuarioNaMesmaTransacao(c);
      const ag = await agendamento(
        c,
        "2030-05-01T10:00:00-03:00",
        "2030-05-01T11:00:00-03:00",
        "atendido",
      );
      await voltarParaUsuario(c, recepcao);
      await c.query(SQL_PAGAR, [cli, ag]);
      const e = await esperarErroSql(c.query(SQL_PAGAR, [cli, ag]), "23505");
      expect(e.message).toContain("cobrancas_agendamento_unico");
    });
  });

  it("a unicidade vale também para inserção direta de cobranças (superusuário)", async () => {
    await comoSuperusuario(async (c) => {
      await savepoint(c, async () => {
        const caixa = (
          await c.query<{ id: string }>(
            `insert into caixas (data, aberto_por, valor_inicial_centavos)
             values ('2030-05-02', $1, 0) returning id`,
            [recepcaoId],
          )
        ).rows[0].id;
        const ag = await agendamento(
          c,
          "2030-05-02T10:00:00-03:00",
          "2030-05-02T11:00:00-03:00",
          "atendido",
        );
        const ins = () =>
          c.query(
            `insert into cobrancas (origem, agendamento_id, cliente_id, valor_bruto_centavos, caixa_id, lancada_por)
             values ('agendamento', $3, $2, 100, $1, $4)`,
            [caixa, cli, ag, recepcaoId],
          );
        await ins();
        await c.query("savepoint segundo");
        const e = await esperarErroSql(ins(), "23505");
        expect(e.message).toContain("cobrancas_agendamento_unico");
        await c.query("rollback to savepoint segundo");
      });
    });
  });

  it.each(["pendente", "confirmado", "faltou", "cancelado"])(
    "atendimento %s não recebe pagamento (P0001)",
    async (status) => {
      await comoUsuario(dona, async (c) => {
        await c.query("select abrir_caixa(0)");
        await comoSuperusuarioNaMesmaTransacao(c);
        const ag = await agendamento(
          c,
          "2030-05-03T10:00:00-03:00",
          "2030-05-03T11:00:00-03:00",
          status,
        );
        await voltarParaUsuario(c, dona);
        const e = await esperarErroSql(c.query(SQL_PAGAR, [cli, ag]), "P0001");
        expect(e.message).toBe(MSG_NAO_CONCLUIDO);
      });
    },
  );

  it("registrar_pagamento continua security definer, só para authenticated", async () => {
    const r = await comoSuperusuario((c) =>
      c.query<{ definer: boolean; anon: boolean; auth: boolean; config: string[] }>(
        `select p.prosecdef as definer,
                has_function_privilege('anon', p.oid, 'execute') as anon,
                has_function_privilege('authenticated', p.oid, 'execute') as auth,
                p.proconfig as config
         from pg_proc p where p.proname = 'registrar_pagamento'`,
      ),
    );
    expect(r.rows).toEqual([
      { definer: true, anon: false, auth: true, config: ['search_path=""'] },
    ]);
  });
});

// Superusuário cria fixtures dentro da transação do usuário (now() fixo).
async function comoSuperusuarioNaMesmaTransacao(c: PoolClient) {
  await c.query("reset role");
}
async function voltarParaUsuario(c: PoolClient, uid: string) {
  await c.query("set local role authenticated");
  await c.query("select set_config('request.jwt.claims', $1, true)", [
    JSON.stringify({ sub: uid, role: "authenticated" }),
  ]);
}

describe("agendamentos_sem_pagamento_periodo", () => {
  let dia1: string;
  let dia3: string;
  let dia7MeiaNoite: string;
  const ids: string[] = [];

  beforeAll(async () => {
    await comoSuperusuario(async (c) => {
      dia1 = await agendamento(c, "2030-06-01T09:00:00-03:00", "2030-06-01T10:00:00-03:00", "atendido");
      dia3 = await agendamento(c, "2030-06-03T09:00:00-03:00", "2030-06-03T10:00:00-03:00", "atendido");
      // 23:30 do dia 7 em São Paulo (02:30 UTC do dia 8): entra no dia 7.
      dia7MeiaNoite = await agendamento(
        c,
        "2030-06-07T23:30:00-03:00",
        "2030-06-08T00:20:00-03:00",
        "atendido",
      );
      // Fora do período, de pacote, ou não atendido: não entram.
      ids.push(
        await agendamento(c, "2030-05-31T23:00:00-03:00", "2030-05-31T23:50:00-03:00", "atendido"),
        await agendamento(c, "2030-06-08T09:00:00-03:00", "2030-06-08T10:00:00-03:00", "atendido"),
        await agendamento(c, "2030-06-02T09:00:00-03:00", "2030-06-02T10:00:00-03:00", "atendido", true),
        await agendamento(c, "2030-06-04T09:00:00-03:00", "2030-06-04T10:00:00-03:00", "confirmado"),
      );
    });
  });

  async function lista(uid: string, de = "2030-06-01", ate = "2030-06-07") {
    const r = await comoUsuario(uid, (c) =>
      c.query<{ id: string }>(
        "select id from agendamentos_sem_pagamento_periodo($1::date, $2::date) as id",
        [de, ate],
      ),
    );
    return r.rows.map((l) => l.id);
  }

  it.each([
    ["dona", () => dona],
    ["recepção", () => recepcao],
  ] as const)("%s: atendidos do período sem pagamento, por início", async (_n, uid) => {
    expect(await lista(uid())).toEqual([dia1, dia3, dia7MeiaNoite]);
  });

  it("pago sai da lista", async () => {
    const r = await comoUsuario(recepcao, async (c) => {
      await c.query("select abrir_caixa(0)");
      await c.query(SQL_PAGAR, [cli, dia3]);
      return (
        await c.query<{ id: string }>(
          "select id from agendamentos_sem_pagamento_periodo('2030-06-01', '2030-06-07') as id",
        )
      ).rows.map((l) => l.id);
    });
    expect(r).toEqual([dia1, dia7MeiaNoite]);
  });

  it.each([
    ["profissional", () => profissional],
    ["recepção inativa", () => recepcaoInativa],
  ] as const)("%s: nada", async (_n, uid) => {
    expect(await lista(uid())).toEqual([]);
  });

  it("anônimo não executa (42501)", async () => {
    await comoUsuario(null, (c) =>
      esperarErroSql(
        c.query("select agendamentos_sem_pagamento_periodo('2030-06-01', '2030-06-07')"),
        "42501",
      ),
    );
  });

  it("período invertido ou longo demais é rejeitado (P0001)", async () => {
    await comoUsuario(dona, (c) =>
      esperarErroSql(
        c.query("select agendamentos_sem_pagamento_periodo('2030-06-07', '2030-06-01')"),
        "P0001",
      ),
    );
    await comoUsuario(dona, (c) =>
      esperarErroSql(
        c.query("select agendamentos_sem_pagamento_periodo('2030-01-01', '2030-12-31')"),
        "P0001",
      ),
    );
  });
});

describe("aniversariantes_entre", () => {
  const nomes = new Map<string, string>();

  beforeAll(async () => {
    await comoSuperusuario(async (c) => {
      await c.query("delete from agendamentos");
      const cliente = async (nome: string, nascimento: string | null, ativo = true) => {
        const r = await c.query<{ id: string }>(
          `insert into clientes (nome, data_nascimento, ativo, aceite_lgpd_em)
           values ($1, $2, $3, now()) returning id`,
          [nome, nascimento, ativo],
        );
        nomes.set(r.rows[0].id, nome);
      };
      await cliente("Ana 30/12", "1990-12-30");
      await cliente("Bia 02/01", "1985-01-02");
      await cliente("Carla 31/12", "2000-12-31");
      await cliente("Duda 29/02", "1992-02-29");
      await cliente("Eva 28/02", "1980-02-28");
      await cliente("Fê 01/03", "1975-03-01");
      await cliente("Gabi 15/06", "1995-06-15");
      await cliente("Inativa 30/12", "1990-12-30", false);
      await cliente("Sem data", null);
      // Muitas clientes fora do período: o filtro é no banco, sem limite de linhas.
      await c.query(
        `insert into clientes (nome, data_nascimento, aceite_lgpd_em)
         select 'Massa ' || g, date '1990-07-10', now() from generate_series(1, 1500) g`,
      );
    });
  });

  async function entre(uid: string, de: string, ate: string) {
    const r = await comoUsuario(uid, (c) =>
      c.query<{ id: string; dias: number; data_nascimento: string; whatsapp: string | null }>(
        "select id, dias, to_char(data_nascimento, 'YYYY-MM-DD') as data_nascimento, whatsapp from aniversariantes_entre($1::date, $2::date)",
        [de, ate],
      ),
    );
    return r.rows.map((l) => ({ nome: nomes.get(l.id), dias: l.dias }));
  }

  it("virada de ano: ordena pelos dias até o aniversário a partir de `de`", async () => {
    expect(await entre(dona, "2030-12-29", "2031-01-04")).toEqual([
      { nome: "Ana 30/12", dias: 1 },
      { nome: "Carla 31/12", dias: 2 },
      { nome: "Bia 02/01", dias: 4 },
    ]);
  });

  it("29/02 conta em 28/02 em ano comum", async () => {
    expect(await entre(dona, "2031-02-26", "2031-02-28")).toEqual([
      { nome: "Duda 29/02", dias: 2 },
      { nome: "Eva 28/02", dias: 2 },
    ]);
  });

  it("29/02 conta em 29/02 em ano bissexto (e não em 28/02)", async () => {
    expect(await entre(dona, "2032-02-28", "2032-03-01")).toEqual([
      { nome: "Eva 28/02", dias: 0 },
      { nome: "Duda 29/02", dias: 1 },
      { nome: "Fê 01/03", dias: 2 },
    ]);
    expect(await entre(dona, "2032-02-28", "2032-02-28")).toEqual([
      { nome: "Eva 28/02", dias: 0 },
    ]);
  });

  it("mais de 1000 clientes no período: todas voltam", async () => {
    const r = await entre(dona, "2030-07-10", "2030-07-10");
    expect(r).toHaveLength(1500);
  });

  it("security invoker: RLS de clientes vale (profissional sem vínculo não vê ninguém)", async () => {
    expect(await entre(profissional, "2030-12-29", "2031-01-04")).toEqual([]);
    expect(await entre(recepcao, "2030-12-29", "2031-01-04")).toHaveLength(3);
    const r = await comoSuperusuario((c) =>
      c.query<{ definer: boolean; volatil: string; anon: boolean }>(
        `select prosecdef as definer, provolatile as volatil,
                has_function_privilege('anon', oid, 'execute') as anon
         from pg_proc where proname = 'aniversariantes_entre'`,
      ),
    );
    expect(r.rows).toEqual([{ definer: false, volatil: "s", anon: false }]);
  });

  it("período invertido: vazio", async () => {
    expect(await entre(dona, "2031-01-04", "2030-12-29")).toEqual([]);
  });

  it("não altera dados", async () => {
    await comoUsuario(dona, async (c) => {
      expect(await contar(c, "clientes")).toBeGreaterThan(1500);
    });
  });
});
