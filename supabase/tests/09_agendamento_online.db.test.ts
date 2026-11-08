import type { PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  abrirConexao,
  comoSuperusuario,
  comoUsuario,
  contar,
  criarUsuario,
  esperarErroSql,
  fecharConexoes,
  resetarBanco,
} from "./helpers";

// 0009 (seções 1–4): pedidos_online, reserva por exclusion constraint, gatilho
// na agenda, expiração (24 h), limpeza LGPD (90 dias), leitura para a agenda,
// configurações e cron condicional.

const MSG_PEDIDO = "Há um pedido online neste horário. Aprove ou recuse o pedido primeiro.";
const AVISO =
  "Usamos seu nome e WhatsApp só para responder este pedido de horário. Se o pedido não virar atendimento, apagamos esses dados em até 90 dias.";

let dona: string;
let recepcao: string;
let profA: string;
let profAId: string;
let profBId: string;
let cli: string;
let servico: string;

// Dias de teste em 2031; tudo roda em transação desfeita.
const h = (dia: string, hhmm: string) => `2031-03-${dia}T${hhmm}:00-03:00`;

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

type NovoPedido = {
  profissional?: string;
  inicio: string;
  minutos?: number;
  status?: string;
  /** Idade do pedido, ex.: '25 hours', '91 days'. */
  idade?: string;
  nome?: string;
  whatsapp?: string;
};

const SQL_PEDIDO = `insert into pedidos_online (servico_id, profissional_id, inicio, fim, status,
    nome, whatsapp, aceite_privacidade_em, ip_hash, criado_em)
  values ($1, $2, $3::timestamptz, $3::timestamptz + make_interval(mins => $4), $5,
    $6, $7, now(), 'hash', now() - $8::interval)
  returning id`;

const paramsPedido = (p: NovoPedido) => [
  servico,
  p.profissional ?? profAId,
  p.inicio,
  p.minutos ?? 30,
  p.status ?? "aguardando",
  p.nome ?? "Maria Souza",
  p.whatsapp ?? "5511987654321",
  p.idade ?? "0 seconds",
];

/** Superusuário: grava um pedido (criado_em no passado conforme `idade`). */
async function pedido(c: PoolClient, p: NovoPedido): Promise<string> {
  return (await c.query<{ id: string }>(SQL_PEDIDO, paramsPedido(p))).rows[0].id;
}

const SQL_AG = `insert into agendamentos (cliente_id, profissional_id, servico_id, inicio, fim, status)
  values ($1, $2, $3, $4::timestamptz, $4::timestamptz + interval '30 minutes', $5) returning id`;
const paramsAg = (inicio: string, status = "confirmado", prof = profAId) => [
  cli,
  prof,
  servico,
  inicio,
  status,
];

beforeAll(async () => {
  await resetarBanco();
  dona = (await criarUsuario("dona")).uid;
  recepcao = (await criarUsuario("recepcao")).uid;
  ({ uid: profA, colaboradorId: profAId } = await criarUsuario("profissional"));
  ({ colaboradorId: profBId } = await criarUsuario("profissional"));
  await comoSuperusuario(async (c) => {
    const id = async (sql: string, p: unknown[] = []) =>
      (await c.query<{ id: string }>(sql, p)).rows[0].id;
    cli = await id("insert into clientes (nome, aceite_lgpd_em) values ('Cli', now()) returning id");
    const cat = await id("insert into categorias_servico (nome) values ('Facial') returning id");
    servico = await id(
      `insert into servicos (nome, categoria_id, duracao_min, preco_centavos)
       values ('Peeling', $1, 30, 10000) returning id`,
      [cat],
    );
  });
});

afterAll(fecharConexoes);

describe("acesso a pedidos_online", () => {
  it("anon não lê nem grava pedidos_online", async () => {
    await comoUsuario(null, (c) =>
      esperarErroSql(c.query("select * from pedidos_online"), "42501"),
    );
    await comoUsuario(null, (c) =>
      esperarErroSql(c.query(SQL_PEDIDO, paramsPedido({ inicio: h("03", "10:00") })), "42501"),
    );
  });

  it("recepção lê pedidos; profissional não lê a tabela (0 linhas)", async () => {
    await comoUsuario(recepcao, async (c) => {
      await comoSuper(c);
      await pedido(c, { inicio: h("03", "10:00") });
      await pedido(c, { inicio: h("03", "10:00"), profissional: profBId });
      await logarComo(c, recepcao);
      expect(await contar(c, "pedidos_online")).toBe(2);
      await logarComo(c, dona);
      expect(await contar(c, "pedidos_online")).toBe(2);
      await logarComo(c, profA);
      expect(await contar(c, "pedidos_online")).toBe(0);
    });
  });

  it("authenticated não insere/atualiza/apaga pedidos_online", async () => {
    await comoUsuario(recepcao, async (c) => {
      await comoSuper(c);
      const id = await pedido(c, { inicio: h("03", "11:00") });
      await logarComo(c, dona);
      await falha(c, SQL_PEDIDO, paramsPedido({ inicio: h("03", "12:00") }), "42501");
      await falha(c, "update pedidos_online set status = 'recusado' where id = $1", [id], "42501");
      await falha(c, "delete from pedidos_online where id = $1", [id], "42501");
      await logarComo(c, recepcao);
      await falha(c, "update pedidos_online set nome = 'X' where id = $1", [id], "42501");
    });
  });
});

describe("reserva: pedidos aguardando não se sobrepõem", () => {
  it("dois pedidos aguardando sobrepostos da mesma profissional → 23P01", async () => {
    await comoSuperusuario(async (c) => {
      await c.query("savepoint s");
      await pedido(c, { inicio: h("04", "10:00") });
      // Outra profissional no mesmo horário: ok.
      await pedido(c, { inicio: h("04", "10:00"), profissional: profBId });
      // Encostado ('[)'): ok.
      await pedido(c, { inicio: h("04", "10:30") });
      await falha(c, SQL_PEDIDO, paramsPedido({ inicio: h("04", "10:15") }), "23P01");
      await c.query("rollback to savepoint s");
    });
  });

  it("o mesmo horário com o primeiro recusado → ok", async () => {
    await comoSuperusuario(async (c) => {
      await c.query("savepoint s");
      await pedido(c, { inicio: h("04", "14:00"), status: "recusado" });
      await pedido(c, { inicio: h("04", "14:00"), status: "expirado" });
      await pedido(c, { inicio: h("04", "14:00") });
      expect(
        (await c.query("select count(*)::int as n from pedidos_online where inicio = $1", [h("04", "14:00")]))
          .rows[0].n,
      ).toBe(3);
      await c.query("rollback to savepoint s");
    });
  });

  it("checks: fim > inicio, nome 2–80, whatsapp 12–13 dígitos, motivo ≤ 200", async () => {
    await comoSuperusuario(async (c) => {
      await c.query("savepoint s");
      await falha(c, SQL_PEDIDO, paramsPedido({ inicio: h("05", "10:00"), minutos: 0 }), "23514");
      await falha(c, SQL_PEDIDO, paramsPedido({ inicio: h("05", "10:00"), nome: "M" }), "23514");
      await falha(c, SQL_PEDIDO, paramsPedido({ inicio: h("05", "10:00"), nome: "M".repeat(81) }), "23514");
      await falha(c, SQL_PEDIDO, paramsPedido({ inicio: h("05", "10:00"), whatsapp: "11987654321" }), "23514");
      await falha(c, SQL_PEDIDO, paramsPedido({ inicio: h("05", "10:00"), whatsapp: "(11)98765-4321" }), "23514");
      const id = await pedido(c, { inicio: h("05", "10:00"), whatsapp: "551187654321" });
      await falha(
        c,
        "update pedidos_online set motivo_recusa = $2 where id = $1",
        [id, "x".repeat(201)],
        "23514",
      );
      // Depois da limpeza, nome e whatsapp nulos são aceitos.
      await c.query("update pedidos_online set nome = null, whatsapp = null where id = $1", [id]);
      await c.query("rollback to savepoint s");
    });
  });
});

describe("gatilho agendamentos_pedido_online", () => {
  it("pedido aguardando não vencido bloqueia com a mensagem exata", async () => {
    await comoUsuario(recepcao, async (c) => {
      await comoSuper(c);
      await pedido(c, { inicio: h("06", "10:00") });
      const outro = (await c.query<{ id: string }>(SQL_AG, paramsAg(h("06", "11:00")))).rows[0].id;
      await logarComo(c, recepcao);
      const erro = await falha(c, SQL_AG, paramsAg(h("06", "10:15")));
      expect(erro.message).toBe(MSG_PEDIDO);
      // Outra profissional no mesmo horário: ok.
      const deB = (await c.query<{ id: string }>(SQL_AG, paramsAg(h("06", "10:00"), "confirmado", profBId)))
        .rows[0].id;
      // Mover um agendamento para cima do pedido também é recusado.
      expect(
        (await falha(c, "update agendamentos set inicio = $2, fim = $2::timestamptz + interval '30 minutes' where id = $1", [outro, h("06", "10:00")])).message,
      ).toBe(MSG_PEDIDO);
      // Trocar a profissional para a do pedido também.
      expect(
        (await falha(c, "update agendamentos set profissional_id = $2 where id = $1", [deB, profAId])).message,
      ).toBe(MSG_PEDIDO);
    });
  });

  it("pedido vencido não bloqueia agendamento interno", async () => {
    await comoUsuario(recepcao, async (c) => {
      await comoSuper(c);
      await pedido(c, { inicio: h("07", "10:00"), idade: "24 hours" });
      await pedido(c, { inicio: h("07", "11:00"), status: "recusado" });
      await logarComo(c, recepcao);
      await c.query(SQL_AG, paramsAg(h("07", "10:00")));
      await c.query(SQL_AG, paramsAg(h("07", "11:00")));
    });
  });

  it("agendamento cancelado sobre o pedido passa; reativá-lo é recusado", async () => {
    await comoUsuario(recepcao, async (c) => {
      await comoSuper(c);
      await pedido(c, { inicio: h("08", "10:00") });
      await logarComo(c, recepcao);
      const ag = (await c.query<{ id: string }>(SQL_AG, paramsAg(h("08", "10:00"), "cancelado"))).rows[0].id;
      expect(
        (await falha(c, "update agendamentos set status = 'confirmado' where id = $1", [ag])).message,
      ).toBe(MSG_PEDIDO);
    });
  });

  it("mudar só o status de um agendamento que já estava ativo não é barrado", async () => {
    await comoUsuario(profA, async (c) => {
      await comoSuper(c);
      const ag = (await c.query<{ id: string }>(SQL_AG, paramsAg(h("09", "10:00")))).rows[0].id;
      // Pedido gravado depois sobre o agendamento (corrida improvável).
      await pedido(c, { inicio: h("09", "10:00") });
      await logarComo(c, profA);
      await c.query("update agendamentos set status = 'atendido' where id = $1", [ag]);
    });
  });
});

describe("trava por profissional", () => {
  it("agendamento em transação aberta trava a agenda; o pedido espera e depois enxerga o agendamento", async () => {
    const inicio = h("15", "10:00");
    const a = await abrirConexao(recepcao);
    const b = await abrirConexao(null);
    try {
      await b.query("reset role");
      await b.query("select set_config('request.jwt.claims', '', false)");
      const pidB = (await b.query<{ pid: number }>("select pg_backend_pid() as pid")).rows[0].pid;

      await a.query("begin");
      await a.query(SQL_AG, paramsAg(inicio));
      const pidA = (await a.query<{ pid: number }>("select pg_backend_pid() as pid")).rows[0].pid;

      const travas = await comoSuperusuario((c) =>
        c.query<{ pid: number }>(
          "select pid from pg_locks where locktype = 'advisory' and granted and pid = $1",
          [pidA],
        ),
      );
      expect(travas.rows).toHaveLength(1);

      // B simula criar_pedido_online: trava, confere a agenda e grava.
      await b.query("begin");
      let travou = false;
      const espera = b
        .query("select public.travar_agenda_profissional($1)", [profAId])
        .then(() => {
          travou = true;
        });
      // B fica esperando a trava de A.
      for (let i = 0; ; i += 1) {
        const r = await comoSuperusuario((c) =>
          c.query(
            "select 1 from pg_locks where locktype = 'advisory' and not granted and pid = $1",
            [pidB],
          ),
        );
        if (r.rowCount) break;
        if (i > 100) throw new Error("B não chegou a esperar a trava");
        await new Promise((ok) => setTimeout(ok, 20));
      }
      expect(travou).toBe(false);

      await a.query("commit");
      await espera;
      expect(travou).toBe(true);
      const ocupado = await b.query(
        `select 1 from agendamentos where profissional_id = $1 and status <> 'cancelado'
           and tstzrange(inicio, fim, '[)') && tstzrange($2::timestamptz, $2::timestamptz + interval '30 minutes', '[)')`,
        [profAId, inicio],
      );
      expect(ocupado.rowCount).toBe(1);
      await b.query("rollback");
    } finally {
      a.release();
      b.release();
      await comoSuperusuario((c) =>
        c.query("delete from agendamentos where profissional_id = $1 and inicio = $2", [profAId, inicio]),
      );
    }
  });

  it("travar_agenda_profissional não é executável por anon nem authenticated", async () => {
    await comoUsuario(null, (c) =>
      esperarErroSql(c.query("select travar_agenda_profissional($1)", [profAId]), "42501"),
    );
    await comoUsuario(dona, (c) =>
      esperarErroSql(c.query("select travar_agenda_profissional($1)", [profAId]), "42501"),
    );
  });
});

describe("expiração e limpeza", () => {
  it("expirar_pedidos_online grava expirado só nos vencidos e devolve a contagem", async () => {
    await comoUsuario(recepcao, async (c) => {
      await comoSuper(c);
      const v1 = await pedido(c, { inicio: h("10", "10:00"), idade: "24 hours" });
      const v2 = await pedido(c, { inicio: h("10", "11:00"), idade: "30 days" });
      const novo = await pedido(c, { inicio: h("10", "12:00"), idade: "23 hours 59 minutes" });
      const rec = await pedido(c, { inicio: h("10", "13:00"), idade: "30 days", status: "recusado" });
      await logarComo(c, recepcao);
      expect((await c.query("select expirar_pedidos_online() as n")).rows[0].n).toBe(2);
      const status = Object.fromEntries(
        (await c.query<{ id: string; status: string }>("select id, status from pedidos_online")).rows.map(
          (l) => [l.id, l.status],
        ),
      );
      expect(status).toEqual({ [v1]: "expirado", [v2]: "expirado", [novo]: "aguardando", [rec]: "recusado" });
      expect((await c.query("select expirar_pedidos_online() as n")).rows[0].n).toBe(0);
    });
  });

  it("pedido_vencido: só aguardando com 24 h ou mais", async () => {
    await comoSuperusuario(async (c) => {
      await c.query("savepoint s");
      const ids = [
        await pedido(c, { inicio: h("11", "10:00"), idade: "24 hours" }),
        await pedido(c, { inicio: h("11", "11:00"), idade: "23 hours" }),
        await pedido(c, { inicio: h("11", "12:00"), idade: "48 hours", status: "recusado" }),
      ];
      const r = await c.query<{ id: string; v: boolean }>(
        "select p.id, public.pedido_vencido(p) as v from pedidos_online p",
      );
      const v = Object.fromEntries(r.rows.map((l) => [l.id, l.v]));
      expect(ids.map((id) => v[id])).toEqual([true, false, false]);
      await c.query("rollback to savepoint s");
    });
  });

  it("anon não executa expirar; authenticated não executa apagar", async () => {
    await comoUsuario(null, (c) =>
      esperarErroSql(c.query("select expirar_pedidos_online()"), "42501"),
    );
    await comoUsuario(dona, (c) =>
      esperarErroSql(c.query("select apagar_dados_pedidos_antigos()"), "42501"),
    );
    await comoUsuario(null, (c) =>
      esperarErroSql(c.query("select * from pedidos_online_da_agenda(now(), now())"), "42501"),
    );
  });

  it("apagar_dados_pedidos_antigos limpa nome/whatsapp de recusado/expirado com 91 dias e mantém aprovado e o de 89 dias", async () => {
    await comoUsuario(dona, async (c) => {
      await comoSuper(c);
      const recusado = await pedido(c, { inicio: h("12", "10:00"), idade: "91 days", status: "recusado" });
      const expirado = await pedido(c, { inicio: h("12", "11:00"), idade: "91 days", status: "expirado" });
      const aprovado = await pedido(c, { inicio: h("12", "12:00"), idade: "91 days", status: "aprovado" });
      const recente = await pedido(c, { inicio: h("12", "13:00"), idade: "89 days", status: "recusado" });
      await c.query("set local role service_role");
      expect((await c.query("select apagar_dados_pedidos_antigos() as n")).rows[0].n).toBe(2);
      const linhas = Object.fromEntries(
        (
          await c.query<{ id: string; nome: string | null; whatsapp: string | null; apagado: boolean }>(
            "select id, nome, whatsapp, dados_apagados_em is not null as apagado from pedidos_online",
          )
        ).rows.map((l) => [l.id, [l.nome, l.whatsapp, l.apagado]]),
      );
      expect(linhas).toEqual({
        [recusado]: [null, null, true],
        [expirado]: [null, null, true],
        [aprovado]: ["Maria Souza", "5511987654321", false],
        [recente]: ["Maria Souza", "5511987654321", false],
      });
      // Já limpos não contam de novo.
      expect((await c.query("select apagar_dados_pedidos_antigos() as n")).rows[0].n).toBe(0);
    });
  });
});

describe("pedidos_online_da_agenda", () => {
  it("profissional vê só os próprios, sem whatsapp; vencido não aparece", async () => {
    await comoUsuario(profA, async (c) => {
      await comoSuper(c);
      const meu = await pedido(c, { inicio: h("13", "10:00"), nome: "  Ana Paula Lima" });
      const deB = await pedido(c, { inicio: h("13", "10:00"), profissional: profBId });
      await pedido(c, { inicio: h("13", "11:00"), idade: "25 hours" });
      await pedido(c, { inicio: h("13", "12:00"), status: "recusado" });
      await pedido(c, { inicio: h("14", "10:00") }); // fora do período
      const de = h("13", "00:00");
      const ate = h("14", "00:00");
      await logarComo(c, profA);
      const r = await c.query("select * from pedidos_online_da_agenda($1, $2)", [de, ate]);
      expect(r.fields.map((f) => f.name)).toEqual([
        "id",
        "profissional_id",
        "servico_id",
        "inicio",
        "fim",
        "primeiro_nome",
        "avaliacao",
      ]);
      expect(r.rows).toEqual([
        {
          id: meu,
          profissional_id: profAId,
          servico_id: servico,
          inicio: new Date(h("13", "10:00")),
          fim: new Date(h("13", "10:30")),
          primeiro_nome: "Ana",
          avaliacao: false,
        },
      ]);
      await logarComo(c, recepcao);
      const todos = await c.query<{ id: string }>(
        "select id from pedidos_online_da_agenda($1, $2) order by profissional_id = $3 desc",
        [de, ate, profAId],
      );
      expect(todos.rows.map((l) => l.id).sort()).toEqual([meu, deB].sort());
    });
  });
});

describe("configurações e cron", () => {
  it("configuracoes_clinica tem online_ativo = false e o aviso padrão", async () => {
    await comoSuperusuario(async (c) => {
      await c.query("savepoint s");
      const r = await c.query(
        `insert into configuracoes_clinica (nome) values ('Madame Fê Clinic')
         returning online_ativo, online_aviso_privacidade`,
      );
      expect(r.rows).toEqual([{ online_ativo: false, online_aviso_privacidade: AVISO }]);
      await c.query("rollback to savepoint s");
    });
  });

  it("sem pg_cron a migração não cria o schema cron", async () => {
    await comoSuperusuario(async (c) => {
      expect((await c.query("select to_regnamespace('cron') as s")).rows[0].s).toBeNull();
    });
  });
});
