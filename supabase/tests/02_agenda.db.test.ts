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

// Atores
let dona: string;
let donaColaboradorId: string;
let recepcao: string;
let recepcaoColaboradorId: string;
let profA: string;
let profAId: string;
let profB: string;
let profBId: string;
let profInativa: string;
let profInativaId: string;
let recepcaoInativa: string;

// Fixtures
let servicoId: string;
let servicoOutroId: string;
let clienteA: string; // vinculada à profissional A
let clienteB: string; // vinculada à profissional B
let clienteC: string; // sem agendamento algum
let clienteInativa: string; // vinculada só à profissional inativa
let agA: string; // A, 2030-01-07 10:00–11:00 -03, confirmado
let agB: string; // B, 2030-01-07 10:00–11:00 -03, pendente
let agInativa: string;

// Os dias de teste ficam em 2030; cada teste de escrita roda em transação
// desfeita (comoUsuario), então as fixtures acima nunca mudam.
const hora = (dia: string, hhmm: string) => `2030-01-${dia}T${hhmm}:00-03:00`;

type NovoAg = {
  cliente?: string;
  profissional: string;
  inicio: string;
  fim: string;
  status?: string;
};

async function inserirAg(c: PoolClient, a: NovoAg) {
  return c.query<{ id: string }>(
    `insert into agendamentos (cliente_id, profissional_id, servico_id, inicio, fim, status)
     values ($1, $2, $3, $4, $5, $6) returning id`,
    [
      a.cliente ?? clienteC,
      a.profissional,
      servicoId,
      a.inicio,
      a.fim,
      a.status ?? "pendente",
    ],
  );
}

beforeAll(async () => {
  await resetarBanco();
  const fe = await criarUsuario("dona", { nome: "Fê" });
  dona = fe.uid;
  donaColaboradorId = fe.colaboradorId;
  const rec = await criarUsuario("recepcao");
  recepcao = rec.uid;
  recepcaoColaboradorId = rec.colaboradorId;
  const a = await criarUsuario("profissional", { nome: "Prof A" });
  profA = a.uid;
  profAId = a.colaboradorId;
  const b = await criarUsuario("profissional", { nome: "Prof B" });
  profB = b.uid;
  profBId = b.colaboradorId;
  const inativa = await criarUsuario("profissional", {
    nome: "Prof Inativa",
    ativo: false,
  });
  profInativa = inativa.uid;
  profInativaId = inativa.colaboradorId;
  recepcaoInativa = (await criarUsuario("recepcao", { ativo: false })).uid;

  await comoSuperusuario(async (c) => {
    const cat = await c.query<{ id: string }>(
      "insert into categorias_servico (nome) values ('Facial') returning id",
    );
    const serv = await c.query<{ id: string }>(
      `insert into servicos (nome, categoria_id, duracao_min, preco_centavos)
       values ('Peeling', $1, 60, 25000) returning id`,
      [cat.rows[0].id],
    );
    servicoId = serv.rows[0].id;
    const outro = await c.query<{ id: string }>(
      `insert into servicos (nome, categoria_id, duracao_min, preco_centavos)
       values ('Limpeza de pele', $1, 90, 18000) returning id`,
      [cat.rows[0].id],
    );
    servicoOutroId = outro.rows[0].id;

    const cliente = async (nome: string) =>
      (
        await c.query<{ id: string }>(
          "insert into clientes (nome, aceite_lgpd_em) values ($1, now()) returning id",
          [nome],
        )
      ).rows[0].id;
    clienteA = await cliente("Cliente A");
    clienteB = await cliente("Cliente B");
    clienteC = await cliente("Cliente C");
    clienteInativa = await cliente("Cliente da inativa");

    agA = (
      await inserirAg(c, {
        cliente: clienteA,
        profissional: profAId,
        inicio: hora("07", "10:00"),
        fim: hora("07", "11:00"),
        status: "confirmado",
      })
    ).rows[0].id;
    agB = (
      await inserirAg(c, {
        cliente: clienteB,
        profissional: profBId,
        inicio: hora("07", "10:00"),
        fim: hora("07", "11:00"),
        status: "pendente",
      })
    ).rows[0].id;
    agInativa = (
      await inserirAg(c, {
        cliente: clienteInativa,
        profissional: profInativaId,
        inicio: hora("07", "14:00"),
        fim: hora("07", "15:00"),
        status: "confirmado",
      })
    ).rows[0].id;
  });
});

afterAll(fecharConexoes);

describe("estrutura", () => {
  it("enums status_agendamento e origem_agendamento", async () => {
    const r = await comoSuperusuario((c) =>
      c.query<{ tipo: string; valores: string[] }>(
        `select t.typname as tipo, array_agg(e.enumlabel::text order by e.enumsortorder) as valores
         from pg_type t join pg_enum e on e.enumtypid = t.oid
         where t.typnamespace = 'public'::regnamespace
           and t.typname in ('status_agendamento', 'origem_agendamento')
         group by t.typname order by t.typname`,
      ),
    );
    expect(r.rows).toEqual([
      { tipo: "origem_agendamento", valores: ["interno", "online"] },
      {
        tipo: "status_agendamento",
        valores: ["pendente", "confirmado", "atendido", "faltou", "cancelado"],
      },
    ]);
  });

  it("índices por profissional/início e cliente/início", async () => {
    const r = await comoSuperusuario((c) =>
      c.query<{ def: string }>(
        `select indexdef as def from pg_indexes
         where schemaname = 'public' and tablename = 'agendamentos'`,
      ),
    );
    const defs = r.rows.map((l) => l.def).join("\n");
    expect(defs).toContain("(profissional_id, inicio)");
    expect(defs).toContain("(cliente_id, inicio)");
  });

  it("pacote_vendido_id e google_event_id são nulos e sem FK nesta fase", async () => {
    const r = await comoSuperusuario(async (c) => {
      const colunas = await c.query<{ column_name: string; is_nullable: string }>(
        `select column_name, is_nullable from information_schema.columns
         where table_schema = 'public' and table_name = 'agendamentos'
           and column_name in ('pacote_vendido_id', 'google_event_id')
         order by column_name`,
      );
      const fks = await c.query(
        `select 1 from pg_constraint con
         join pg_attribute att on att.attrelid = con.conrelid and att.attnum = any (con.conkey)
         where con.conrelid = 'public.agendamentos'::regclass and con.contype = 'f'
           and att.attname in ('pacote_vendido_id', 'google_event_id')`,
      );
      return { colunas: colunas.rows, fks: fks.rowCount };
    });
    expect(r.colunas).toEqual([
      { column_name: "google_event_id", is_nullable: "YES" },
      { column_name: "pacote_vendido_id", is_nullable: "YES" },
    ]);
    expect(r.fks).toBe(0);
  });

  it("valores padrão e criado_por = colaborador logado", async () => {
    const r = await comoUsuario(recepcao, async (c) => {
      const ins = await c.query<{ id: string }>(
        `insert into agendamentos (cliente_id, profissional_id, servico_id, inicio, fim)
         values ($1, $2, $3, $4, $5) returning id`,
        [clienteC, profAId, servicoId, hora("08", "09:00"), hora("08", "10:00")],
      );
      return c.query(
        `select status, origem, valor_previsto_centavos, observacoes, criado_por
         from agendamentos where id = $1`,
        [ins.rows[0].id],
      );
    });
    expect(r.rows[0]).toEqual({
      status: "pendente",
      origem: "interno",
      valor_previsto_centavos: 0,
      observacoes: null,
      criado_por: recepcaoColaboradorId,
    });
  });

  it("atualizado_em é renovado no update", async () => {
    const ok = await comoSuperusuario(async (c) => {
      await c.query("savepoint s");
      await c.query(
        "update agendamentos set criado_em = now() - interval '1 day', atualizado_em = now() - interval '1 day' where id = $1",
        [agA],
      );
      const r = await c.query<{ ok: boolean }>(
        `update agendamentos set observacoes = 'x' where id = $1
         returning atualizado_em > criado_em as ok`,
        [agA],
      );
      await c.query("rollback to savepoint s");
      return r.rows[0].ok;
    });
    expect(ok).toBe(true);
  });
});

describe("restrições de dados", () => {
  it("fim igual ao início é rejeitado (23514)", async () => {
    await comoUsuario(dona, (c) =>
      esperarErroSql(
        inserirAg(c, {
          profissional: profAId,
          inicio: hora("09", "10:00"),
          fim: hora("09", "10:00"),
        }),
        "23514",
      ),
    );
  });

  it("fim antes do início é rejeitado (23514)", async () => {
    await comoUsuario(dona, (c) =>
      esperarErroSql(
        inserirAg(c, {
          profissional: profAId,
          inicio: hora("09", "11:00"),
          fim: hora("09", "10:00"),
        }),
        "23514",
      ),
    );
  });

  it("valor previsto negativo é rejeitado (23514)", async () => {
    await comoUsuario(dona, (c) =>
      esperarErroSql(
        c.query(
          `insert into agendamentos (cliente_id, profissional_id, servico_id, inicio, fim, valor_previsto_centavos)
           values ($1, $2, $3, $4, $5, -1)`,
          [clienteC, profAId, servicoId, hora("09", "10:00"), hora("09", "11:00")],
        ),
        "23514",
      ),
    );
  });

  it("cliente inexistente é rejeitada (23503)", async () => {
    await comoUsuario(dona, (c) =>
      esperarErroSql(
        c.query(
          `insert into agendamentos (cliente_id, profissional_id, servico_id, inicio, fim)
           values (gen_random_uuid(), $1, $2, $3, $4)`,
          [profAId, servicoId, hora("09", "10:00"), hora("09", "11:00")],
        ),
        "23503",
      ),
    );
  });
});

describe("sobreposição (Review Focus 2)", () => {
  it("barra sobreposição, permite encostado, cancelado libera, outra profissional pode", async () => {
    await comoUsuario(dona, async (c) => {
      const base = await inserirAg(c, {
        profissional: profAId,
        inicio: hora("10", "10:00"),
        fim: hora("10", "11:00"),
        status: "confirmado",
      });

      // sobreposição parcial: barrada pela constraint do banco
      await c.query("savepoint s1");
      const erro = await esperarErroSql(
        inserirAg(c, {
          profissional: profAId,
          inicio: hora("10", "10:30"),
          fim: hora("10", "11:30"),
        }),
        "23P01",
      );
      expect(erro.constraint).toBe("agendamentos_sem_sobreposicao");
      await c.query("rollback to savepoint s1");

      // contido dentro do existente: barrado
      await c.query("savepoint s2");
      await esperarErroSql(
        inserirAg(c, {
          profissional: profAId,
          inicio: hora("10", "10:15"),
          fim: hora("10", "10:45"),
        }),
        "23P01",
      );
      await c.query("rollback to savepoint s2");

      // encostado (11:00–12:00 depois de 10:00–11:00) é permitido
      await inserirAg(c, {
        profissional: profAId,
        inicio: hora("10", "11:00"),
        fim: hora("10", "12:00"),
      });
      // e encostado antes (09:00–10:00) também
      await inserirAg(c, {
        profissional: profAId,
        inicio: hora("10", "09:00"),
        fim: hora("10", "10:00"),
      });

      // outra profissional no mesmo horário pode
      await inserirAg(c, {
        profissional: profBId,
        inicio: hora("10", "10:00"),
        fim: hora("10", "11:00"),
      });

      // cancelar libera o horário
      const cancelado = await c.query(
        "update agendamentos set status = 'cancelado' where id = $1",
        [base.rows[0].id],
      );
      expect(cancelado.rowCount).toBe(1);
      await inserirAg(c, {
        profissional: profAId,
        inicio: hora("10", "10:00"),
        fim: hora("10", "11:00"),
      });
    });
  });

  it("agendamento cancelado não bloqueia outro e pode coexistir com vários cancelados", async () => {
    await comoUsuario(recepcao, async (c) => {
      for (let i = 0; i < 2; i++) {
        await inserirAg(c, {
          profissional: profAId,
          inicio: hora("11", "10:00"),
          fim: hora("11", "11:00"),
          status: "cancelado",
        });
      }
      await inserirAg(c, {
        profissional: profAId,
        inicio: hora("11", "10:00"),
        fim: hora("11", "11:00"),
      });
    });
  });

  it("reativar um cancelado sobre horário ocupado é barrado (23P01)", async () => {
    await comoUsuario(recepcao, async (c) => {
      const velho = await inserirAg(c, {
        profissional: profAId,
        inicio: hora("12", "10:00"),
        fim: hora("12", "11:00"),
        status: "cancelado",
      });
      await inserirAg(c, {
        profissional: profAId,
        inicio: hora("12", "10:00"),
        fim: hora("12", "11:00"),
      });
      await esperarErroSql(
        c.query("update agendamentos set status = 'pendente' where id = $1", [
          velho.rows[0].id,
        ]),
        "23P01",
      );
    });
  });

  it("mover o agendamento de B para a profissional A no mesmo horário é barrado (23P01)", async () => {
    await comoUsuario(recepcao, (c) =>
      esperarErroSql(
        c.query("update agendamentos set profissional_id = $2 where id = $1", [
          agB,
          profAId,
        ]),
        "23P01",
      ),
    );
  });
});

describe("visibilidade (select)", () => {
  it("dona e recepção veem todos os agendamentos", async () => {
    expect(await comoUsuario(dona, (c) => contar(c, "agendamentos"))).toBe(3);
    expect(await comoUsuario(recepcao, (c) => contar(c, "agendamentos"))).toBe(
      3,
    );
  });

  it("profissional vê só os próprios", async () => {
    const [proprios, deB, total] = await comoUsuario(profA, async (c) => [
      (
        await c.query<{ n: number }>(
          "select count(*)::int n from agendamentos where profissional_id = $1",
          [profAId],
        )
      ).rows[0].n,
      (
        await c.query<{ n: number }>(
          "select count(*)::int n from agendamentos where profissional_id = $1",
          [profBId],
        )
      ).rows[0].n,
      await contar(c, "agendamentos"),
    ]);
    expect(proprios).toBe(1);
    expect(deB).toBe(0);
    expect(total).toBe(1);
  });

  it("cada profissional vê só o próprio agendamento (B não vê o de A)", async () => {
    const ids = await comoUsuario(profB, async (c) =>
      (await c.query<{ id: string }>("select id from agendamentos")).rows.map(
        (l) => l.id,
      ),
    );
    expect(ids).toEqual([agB]);
  });

  it("profissional passa a ver só a cliente vinculada", async () => {
    const [daA, daB, daC, total] = await comoUsuario(profA, async (c) => {
      const por = async (id: string) =>
        (
          await c.query<{ n: number }>(
            "select count(*)::int n from clientes where id = $1",
            [id],
          )
        ).rows[0].n;
      return [
        await por(clienteA),
        await por(clienteB),
        await por(clienteC),
        await contar(c, "clientes"),
      ];
    });
    expect([daA, daB, daC, total]).toEqual([1, 0, 0, 1]);
  });

  it("vínculo vale para qualquer status (cancelado continua vinculando)", async () => {
    const n = await comoUsuario(dona, async (c) => {
      await c.query(
        "update agendamentos set status = 'cancelado' where id = $1",
        [agA],
      );
      // Agora como profissional A na mesma transação.
      await c.query("set local role authenticated");
      await c.query("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify({ sub: profA, role: "authenticated" }),
      ]);
      return contar(c, "clientes");
    });
    expect(n).toBe(1);
  });

  it("colaboradores inativos não veem agendamentos nem clientes", async () => {
    for (const uid of [profInativa, recepcaoInativa]) {
      const [ags, clientes] = await comoUsuario(uid, async (c) => [
        await contar(c, "agendamentos"),
        await contar(c, "clientes"),
      ]);
      expect(ags).toBe(0);
      expect(clientes).toBe(0);
    }
  });

  it("anônimo não vê agendamentos", async () => {
    expect(await comoUsuario(null, (c) => contar(c, "agendamentos"))).toBe(0);
  });

  it("anônimo não executa cliente_vinculada (42501)", async () => {
    await comoUsuario(null, (c) =>
      esperarErroSql(
        c.query("select public.cliente_vinculada(gen_random_uuid())"),
        "42501",
      ),
    );
  });

  it("cliente_vinculada: true para a própria cliente, false para outras", async () => {
    const r = await comoUsuario(profA, (c) =>
      c.query<{ a: boolean; b: boolean }>(
        "select public.cliente_vinculada($1) a, public.cliente_vinculada($2) b",
        [clienteA, clienteB],
      ),
    );
    expect(r.rows[0]).toEqual({ a: true, b: false });
  });
});

describe("escrita por dona e recepção", () => {
  it.each([
    ["dona", () => dona],
    ["recepcao", () => recepcao],
  ] as const)("%s altera qualquer campo de qualquer agendamento", async (_n, uid) => {
    const atualizacoes: [string, unknown[]][] = [
      ["inicio = $2, fim = $3", [hora("07", "16:00"), hora("07", "17:00")]],
      ["profissional_id = $2", [profBId]],
      ["cliente_id = $2", [clienteC]],
      ["servico_id = $2", [servicoOutroId]],
      ["valor_previsto_centavos = $2", [12345]],
      ["observacoes = $2", ["obs"]],
      ["origem = $2", ["online"]],
      ["status = $2", ["pendente"]],
      ["status = $2", ["cancelado"]],
      ["status = $2", ["atendido"]],
      ["status = $2", ["faltou"]],
    ];
    await comoUsuario(uid(), async (c) => {
      for (const [set, params] of atualizacoes) {
        const r = await c.query(
          `update agendamentos set ${set} where id = $1`,
          [agInativa, ...params],
        );
        expect(r.rowCount, set).toBe(1);
      }
    });
  });
});

describe("escrita por profissional (trigger agendamentos_guarda_profissional)", () => {
  const MENSAGEM = "Profissional só pode alterar o status do próprio atendimento";

  it.each(["confirmado", "atendido", "faltou"])(
    "marca o próprio atendimento como %s",
    async (status) => {
      const r = await comoUsuario(profA, (c) =>
        c.query("update agendamentos set status = $2 where id = $1", [
          agA,
          status,
        ]),
      );
      expect(r.rowCount).toBe(1);
    },
  );

  it("atualizado_em é renovado ao marcar atendido", async () => {
    const r = await comoUsuario(profA, async (c) => {
      const antes = await c.query<{ t: Date }>(
        "select atualizado_em t from agendamentos where id = $1",
        [agA],
      );
      await c.query("select pg_sleep(0.01)");
      await c.query("update agendamentos set status = 'atendido' where id = $1", [agA]);
      const depois = await c.query<{ t: Date }>(
        "select atualizado_em t from agendamentos where id = $1",
        [agA],
      );
      return depois.rows[0].t > antes.rows[0].t;
    });
    expect(r).toBe(true);
  });

  it.each(["pendente", "cancelado"])(
    "não marca como %s (P0001)",
    async (status) => {
      const erro = await comoUsuario(profA, (c) =>
        esperarErroSql(
          c.query("update agendamentos set status = $2 where id = $1", [
            agA,
            status,
          ]),
          "P0001",
        ),
      );
      expect(erro.message).toBe(MENSAGEM);
    },
  );

  // Parâmetros são funções: os ids só existem depois do beforeAll.
  const proibidas: [string, string, () => unknown[]][] = [
    ["remarcar (início)", "inicio = inicio + interval '1 hour'", () => []],
    ["alterar o fim", "fim = fim + interval '1 hour'", () => []],
    ["trocar de profissional", "profissional_id = $2", () => [profBId]],
    ["trocar de cliente", "cliente_id = $2", () => [clienteC]],
    ["trocar o serviço", "servico_id = $2", () => [servicoOutroId]],
    ["alterar o valor previsto", "valor_previsto_centavos = 1", () => []],
    ["alterar observações", "observacoes = 'x'", () => []],
    ["alterar a origem", "origem = 'online'", () => []],
    ["alterar criado_por", "criado_por = $2", () => [donaColaboradorId]],
    ["alterar google_event_id", "google_event_id = 'g'", () => []],
    ["alterar pacote_vendido_id", "pacote_vendido_id = gen_random_uuid()", () => []],
    ["status válido junto com outro campo", "status = 'atendido', observacoes = 'x'", () => []],
  ];
  it.each(proibidas)("não pode %s (P0001)", async (_nome, set, params) => {
    const erro = await comoUsuario(profA, (c) =>
      esperarErroSql(
        c.query(`update agendamentos set ${set} where id = $1`, [agA, ...params()]),
        "P0001",
      ),
    );
    expect(erro.message).toBe(MENSAGEM);
  });

  it("não altera agendamento de outra profissional (0 linhas)", async () => {
    const r = await comoUsuario(profA, (c) =>
      c.query("update agendamentos set status = 'atendido' where id = $1", [agB]),
    );
    expect(r.rowCount).toBe(0);
  });

  it("update em todas as linhas só alcança as próprias", async () => {
    const r = await comoUsuario(profA, (c) =>
      c.query("update agendamentos set status = 'atendido'"),
    );
    expect(r.rowCount).toBe(1);
  });

  it("não insere agendamento (42501)", async () => {
    await comoUsuario(profA, (c) =>
      esperarErroSql(
        inserirAg(c, {
          profissional: profAId,
          inicio: hora("20", "10:00"),
          fim: hora("20", "11:00"),
        }),
        "42501",
      ),
    );
  });
});

describe("exclusão", () => {
  it.each([
    ["dona", () => dona],
    ["recepcao", () => recepcao],
    ["profA", () => profA],
  ] as const)("%s não exclui agendamentos (0 linhas)", async (_n, uid) => {
    const r = await comoUsuario(uid(), (c) =>
      c.query("delete from agendamentos where true"),
    );
    expect(r.rowCount).toBe(0);
  });

  it("nada foi excluído", async () => {
    const n = await comoSuperusuario((c) => contar(c, "agendamentos"));
    expect(n).toBe(3);
  });
});

describe("matriz de inserção por perfil (RLS WITH CHECK)", () => {
  const casos: [string, () => string | null, boolean][] = [
    ["dona", () => dona, true],
    ["recepcao", () => recepcao, true],
    ["profissional", () => profA, false],
    ["profissional inativa", () => profInativa, false],
    ["recepcao inativa", () => recepcaoInativa, false],
    ["anon", () => null, false],
  ];
  it.each(casos)("%s", async (_nome, uid, permitido) => {
    const inserir = (c: PoolClient) =>
      inserirAg(c, {
        profissional: profBId,
        inicio: hora("21", "10:00"),
        fim: hora("21", "11:00"),
      });
    if (permitido) {
      const r = await comoUsuario(uid(), inserir);
      expect(r.rowCount).toBe(1);
    } else {
      await comoUsuario(uid(), (c) => esperarErroSql(inserir(c), "42501"));
    }
  });
});

describe("matriz de atualização por perfil", () => {
  const casos: [string, () => string | null, number][] = [
    ["dona", () => dona, 1],
    ["recepcao", () => recepcao, 1],
    ["profissional (própria linha)", () => profA, 1],
    ["profissional inativa", () => profInativa, 0],
    ["recepcao inativa", () => recepcaoInativa, 0],
    ["anon", () => null, 0],
  ];
  it.each(casos)("%s", async (_nome, uid, esperado) => {
    const r = await comoUsuario(uid(), (c) =>
      c.query(
        "update agendamentos set status = 'confirmado' where id = $1",
        [agA],
      ),
    );
    expect(r.rowCount).toBe(esperado);
  });
});
