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

describe("privilégios de authenticated em pedidos_online", () => {
  it("só select: sem references, trigger, insert, update, delete, truncate", async () => {
    await comoSuperusuario(async (c) => {
      const r = await c.query<{ priv: string; tem: boolean }>(
        `select priv, has_table_privilege('authenticated', 'public.pedidos_online', priv) as tem
           from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) priv`,
      );
      expect(Object.fromEntries(r.rows.map((l) => [l.priv, l.tem]))).toEqual({
        SELECT: true,
        INSERT: false,
        UPDATE: false,
        DELETE: false,
        TRUNCATE: false,
        REFERENCES: false,
        TRIGGER: false,
      });
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
    await comoUsuario(null, async (c) => {
      await c.query("reset role");
      await c.query("set local role service_role");
      await esperarErroSql(c.query("select travar_agenda_profissional($1)", [profAId]), "42501");
    });
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

describe("limpeza do ip_hash", () => {
  it("ip_hash aceita null; apagar_dados_pedidos_antigos zera ip_hash de qualquer pedido com mais de 1 dia", async () => {
    await comoUsuario(dona, async (c) => {
      await comoSuper(c);
      const velhoAprovado = await pedido(c, { inicio: h("14", "10:00"), idade: "25 hours", status: "aprovado" });
      const velhoAguardando = await pedido(c, { inicio: h("14", "11:00"), idade: "2 days" });
      const novo = await pedido(c, { inicio: h("14", "12:00"), idade: "23 hours" });
      await c.query("update pedidos_online set ip_hash = null where id = $1", [novo]);
      await c.query("update pedidos_online set ip_hash = 'hash' where id = $1", [novo]);
      await c.query("set local role service_role");
      // Só nome/whatsapp (90 dias) entram na contagem.
      expect((await c.query("select apagar_dados_pedidos_antigos() as n")).rows[0].n).toBe(0);
      const ips = Object.fromEntries(
        (await c.query<{ id: string; ip_hash: string | null; nome: string | null }>(
          "select id, ip_hash, nome from pedidos_online",
        )).rows.map((l) => [l.id, [l.ip_hash, l.nome]]),
      );
      expect(ips).toEqual({
        [velhoAprovado]: [null, "Maria Souza"],
        [velhoAguardando]: [null, "Maria Souza"],
        [novo]: ["hash", "Maria Souza"],
      });
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

// =============================================================================
// 0009 (seções 5–7): horarios_livres_online, criar_pedido_online,
// aprovar_pedido_online e recusar_pedido_online.
//
// Relógio: now() é fixo dentro de cada transação. Os casos de grade usam
// segundas-feiras fixas de abril/2031 com online_antecedencia_max_dias = 3650;
// os de antecedência calculam o dia a partir de now() (hoje em São Paulo) e
// ajustam a configuração dentro da transação desfeita.
// =============================================================================

const MSG_RESERVADO = "Esse horário acabou de ser reservado, escolha outro.";
const MSG_WHATSAPP = "Você já tem 3 pedidos aguardando resposta. Aguarde o retorno da clínica.";
const MSG_TENTATIVAS = "Muitas tentativas. Tente novamente mais tarde.";
const MSG_INDISPONIVEL = "Agendamento online indisponível no momento.";
const MSG_RESPONDIDO = "Este pedido já foi respondido.";
const MSG_PERFIL = "Apenas a dona ou a recepção podem responder pedidos";
const GRADE = ["09:00", "09:15", "09:30", "09:45", "10:00", "10:15", "10:30", "10:45", "11:00"];

// Segundas-feiras de abril/2031.
const SEG1 = "2031-04-07";
const SEG2 = "2031-04-14";
const SEG3 = "2031-04-21";
const hs = (dia: string, hhmm: string) => `${dia}T${hhmm}:00-03:00`;

let ana: string; // "Ana Online" — primeira por nome
let bia: string; // "Bia Online"
let s60: string; // 60 min, online
let sAval: string; // 60 min, online, exige avaliação
let sOff: string; // 60 min, sem permite_online

let seq = 0;
const proximo = () => (seq += 1);

async function comoServico(c: PoolClient) {
  await c.query("reset role");
  await c.query("set local role service_role");
}

async function livres(c: PoolClient, servicoId: string, prof: string | null, dia: string) {
  const r = await c.query<{ hora: string; profissional_id: string }>(
    `select to_char(inicio at time zone 'America/Sao_Paulo', 'HH24:MI') as hora, profissional_id
       from horarios_livres_online($1, $2, $3::date) order by inicio`,
    [servicoId, prof, dia],
  );
  return r.rows;
}
const horas = async (c: PoolClient, servicoId: string, prof: string | null, dia: string) =>
  (await livres(c, servicoId, prof, dia)).map((l) => l.hora);

type NovoOnline = {
  servico?: string;
  profissional?: string | null;
  inicio: string;
  whatsapp?: string;
  ip?: string;
};
const SQL_CRIAR = "select criar_pedido_online($1, $2, $3::timestamptz, $4, $5, $6) as id";
const paramsCriar = (p: NovoOnline) => {
  const n = proximo();
  return [
    p.servico ?? s60,
    p.profissional === undefined ? ana : p.profissional,
    p.inicio,
    "Maria Souza",
    p.whatsapp ?? `55119${String(n).padStart(8, "0")}`,
    p.ip ?? `ip-${n}`,
  ];
};
async function criar(c: PoolClient, p: NovoOnline): Promise<string> {
  return (await c.query<{ id: string }>(SQL_CRIAR, paramsCriar(p))).rows[0].id;
}

const SQL_APROVAR =
  "select aprovar_pedido_online($1, $2, $3, $4::timestamptz, $5::timestamptz, $6) as id";
const SQL_RECUSAR = "select recusar_pedido_online($1, $2)";

/** Superusuário: agendamento direto de `minutos` (padrão 60) para a profissional. */
async function agendar(c: PoolClient, prof: string, inicio: string, minutos = 60, status = "confirmado") {
  await c.query(
    `insert into agendamentos (cliente_id, profissional_id, servico_id, inicio, fim, status)
     values ($1, $2, $3, $4::timestamptz, $4::timestamptz + make_interval(mins => $5), $6)`,
    [cli, prof, s60, inicio, minutos, status],
  );
}

describe("horários livres, criar, aprovar e recusar (seções 5–7)", () => {
  beforeAll(async () => {
    ({ colaboradorId: ana } = await criarUsuario("profissional", { nome: "Ana Online" }));
    ({ colaboradorId: bia } = await criarUsuario("profissional", { nome: "Bia Online" }));
    await comoSuperusuario(async (c) => {
      const id = async (sql: string, p: unknown[] = []) =>
        (await c.query<{ id: string }>(sql, p)).rows[0].id;
      await c.query(
        `insert into configuracoes_clinica (nome, online_ativo, online_antecedencia_max_dias)
         values ('Madame Fê Clinic', true, 3650)`,
      );
      const cat = await id("insert into categorias_servico (nome) values ('Online') returning id");
      const serv = (nome: string, online: boolean, aval: boolean) =>
        id(
          `insert into servicos (nome, categoria_id, duracao_min, preco_centavos, permite_online, exige_avaliacao)
           values ($1, $2, 60, 20000, $3, $4) returning id`,
          [nome, cat, online, aval],
        );
      s60 = await serv("Limpeza", true, false);
      sAval = await serv("Laser", true, true);
      sOff = await serv("Massagem", false, false);
      for (const prof of [ana, bia]) {
        await c.query(
          "insert into jornadas (colaborador_id, dia_semana, hora_inicio, hora_fim) values ($1, 1, '09:00', '12:00')",
          [prof],
        );
        for (const s of [s60, sAval, sOff]) {
          await c.query("insert into colaborador_servicos (colaborador_id, servico_id) values ($1, $2)", [prof, s]);
        }
      }
    });
  });

  it("horarios_livres_online lista 09:00…11:00 de 15 em 15", async () => {
    await comoUsuario(null, async (c) => {
      await comoServico(c);
      expect(await horas(c, s60, ana, SEG1)).toEqual(GRADE);
      expect((await livres(c, s60, ana, SEG1)).every((l) => l.profissional_id === ana)).toBe(true);
      // Terça: sem jornada.
      expect(await horas(c, s60, ana, "2031-04-08")).toEqual([]);
    });
  });

  it("some o horário de agendamento, bloqueio e pedido aguardando; volta com pedido vencido", async () => {
    const semOcupacao = ["09:00", "10:30", "10:45", "11:00"];
    await comoUsuario(null, async (c) => {
      await comoSuper(c);
      await agendar(c, ana, hs(SEG1, "10:00"), 30);
      await agendar(c, ana, hs(SEG1, "11:00"), 60, "cancelado");
      await c.query(
        "insert into bloqueios_agenda (colaborador_id, inicio, fim, motivo) values ($1, $2, $3, 'curso')",
        [ana, hs(SEG2, "10:00"), hs(SEG2, "10:30")],
      );
      const p = await pedido(c, { profissional: ana, inicio: hs(SEG3, "10:00"), minutos: 30 });
      await pedido(c, { profissional: ana, inicio: hs(SEG3, "11:00"), minutos: 60, status: "recusado" });
      await comoServico(c);
      expect(await horas(c, s60, ana, SEG1)).toEqual(semOcupacao);
      expect(await horas(c, s60, ana, SEG2)).toEqual(semOcupacao);
      expect(await horas(c, s60, ana, SEG3)).toEqual(semOcupacao);
      // A outra profissional não é afetada.
      expect(await horas(c, s60, bia, SEG1)).toEqual(GRADE);
      await comoSuper(c);
      await c.query("update pedidos_online set criado_em = now() - interval '24 hours' where id = $1", [p]);
      await comoServico(c);
      expect(await horas(c, s60, ana, SEG3)).toEqual(GRADE);
    });
  });

  it("qualquer uma: devolve a profissional livre quando a outra está ocupada", async () => {
    await comoUsuario(null, async (c) => {
      await comoServico(c);
      const todas = await livres(c, s60, null, SEG1);
      expect(todas.map((l) => l.hora)).toEqual(GRADE);
      expect(todas.every((l) => l.profissional_id === ana)).toBe(true);
      await comoSuper(c);
      await agendar(c, ana, hs(SEG1, "09:00"));
      await comoServico(c);
      const r = await livres(c, s60, null, SEG1);
      expect(r.map((l) => l.hora)).toEqual(GRADE);
      expect(r.map((l) => (l.profissional_id === ana ? "ana" : "bia"))).toEqual([
        "bia", "bia", "bia", "bia", "ana", "ana", "ana", "ana", "ana",
      ]);
      // O pedido "qualquer uma" vai para a livre.
      const id = await criar(c, { profissional: null, inicio: hs(SEG1, "09:00") });
      await comoSuper(c);
      const linha = (
        await c.query("select profissional_id, profissional_escolhida_id from pedidos_online where id = $1", [id])
      ).rows[0];
      expect(linha).toEqual({ profissional_id: bia, profissional_escolhida_id: null });
      await comoServico(c);
      // Agora as duas estão ocupadas às 09:00.
      expect((await livres(c, s60, null, SEG1)).map((l) => l.hora)).toEqual(GRADE.slice(4));
      const erro = await falha(c, SQL_CRIAR, paramsCriar({ profissional: null, inicio: hs(SEG1, "09:00") }));
      expect(erro.message).toBe(MSG_RESERVADO);
    });
  });

  it("antecedência: nada antes de now()+2h; dia hoje+61 vazio; online_ativo=false vazio; serviço sem permite_online vazio", async () => {
    await comoUsuario(null, async (c) => {
      await comoSuper(c);
      // Jornada 09:00–12:00 em todos os dias para Ana (desfeito ao final).
      await c.query(
        `insert into jornadas (colaborador_id, dia_semana, hora_inicio, hora_fim)
         select $1, d, '09:00', '12:00' from generate_series(0, 6) d where d <> 1`,
        [ana],
      );
      const hoje = (
        await c.query<{ d: string }>("select to_char((now() at time zone 'America/Sao_Paulo')::date, 'YYYY-MM-DD') as d")
      ).rows[0].d;
      const dia = (n: number) =>
        new Date(Date.parse(`${hoje}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

      // Mínimo calculado para o corte cair entre 10:00 e 11:00 de hoje+2.
      const { min_h: minH, corte } = (
        await c.query<{ min_h: number; corte: Date }>(
          `select m as min_h, now() + make_interval(hours => m) as corte
             from (select ceil(extract(epoch from ((($1::date + time '10:00') at time zone 'America/Sao_Paulo') - now())) / 3600)::int as m) x`,
          [dia(2)],
        )
      ).rows[0];
      await c.query("update configuracoes_clinica set online_antecedencia_min_horas = $1", [minH]);
      await comoServico(c);
      const esperado = GRADE.filter((hh) => new Date(`${dia(2)}T${hh}:00-03:00`) >= corte);
      expect(esperado.length).toBeGreaterThan(0);
      expect(esperado).not.toContain("09:00");
      expect(await horas(c, s60, ana, dia(2))).toEqual(esperado);

      // Padrão de 2 h: nada antes de now() + 2 h hoje e amanhã.
      await comoSuper(c);
      await c.query("update configuracoes_clinica set online_antecedencia_min_horas = 2");
      await comoServico(c);
      const limite = (await c.query<{ t: Date }>("select now() + interval '2 hours' as t")).rows[0].t;
      for (const d of [dia(0), dia(1)]) {
        for (const hh of await horas(c, s60, ana, d)) {
          expect(new Date(`${d}T${hh}:00-03:00`).getTime()).toBeGreaterThanOrEqual(limite.getTime());
        }
      }

      // Janela de 60 dias: hoje+60 lista, hoje+61 e ontem não.
      await comoSuper(c);
      await c.query("update configuracoes_clinica set online_antecedencia_max_dias = 60");
      await comoServico(c);
      expect(await horas(c, s60, ana, dia(60))).toEqual(GRADE);
      expect(await horas(c, s60, ana, dia(61))).toEqual([]);
      expect(await horas(c, s60, ana, dia(-1))).toEqual([]);
      expect(await horas(c, s60, null, dia(61))).toEqual([]);

      // Serviço sem permite_online, serviço inativo, online desligado.
      expect(await horas(c, sOff, ana, dia(60))).toEqual([]);
      await comoSuper(c);
      await c.query("update servicos set ativo = false where id = $1", [sAval]);
      await comoServico(c);
      expect(await horas(c, sAval, ana, dia(60))).toEqual([]);
      await comoSuper(c);
      await c.query("update configuracoes_clinica set online_ativo = false");
      await comoServico(c);
      expect(await horas(c, s60, ana, dia(60))).toEqual([]);
      expect(await horas(c, s60, null, dia(60))).toEqual([]);
    });
  });

  it("profissional inativa ou sem o serviço não aparece", async () => {
    await comoUsuario(null, async (c) => {
      await comoSuper(c);
      await c.query("update colaboradores set ativo = false where id = $1", [ana]);
      await c.query("delete from colaborador_servicos where colaborador_id = $1 and servico_id = $2", [bia, sAval]);
      await comoServico(c);
      expect(await horas(c, s60, ana, SEG1)).toEqual([]);
      expect(await horas(c, sAval, bia, SEG1)).toEqual([]);
      expect(await horas(c, sAval, null, SEG1)).toEqual([]);
      expect((await livres(c, s60, null, SEG1)).every((l) => l.profissional_id === bia)).toBe(true);
    });
  });

  it("anon e authenticated não executam horarios_livres_online nem criar_pedido_online", async () => {
    for (const uid of [null, dona]) {
      await comoUsuario(uid, (c) =>
        esperarErroSql(c.query("select * from horarios_livres_online($1, $2, $3::date)", [s60, ana, SEG1]), "42501"),
      );
      await comoUsuario(uid, (c) =>
        esperarErroSql(c.query(SQL_CRIAR, paramsCriar({ inicio: hs(SEG1, "09:00") })), "42501"),
      );
    }
  });

  it("criar_pedido_online: corrida em duas conexões no mesmo horário → um uuid e um erro \"acabou de ser reservado\"", async () => {
    const inicio = hs(SEG2, "09:00");
    const a = await abrirConexao(null);
    const b = await abrirConexao(null);
    try {
      for (const x of [a, b]) {
        await x.query("reset role");
        await x.query("set role service_role");
      }
      const pidB = (await b.query<{ pid: number }>("select pg_backend_pid() as pid")).rows[0].pid;
      await a.query("begin");
      await b.query("begin");
      const id = (await a.query<{ id: string }>(SQL_CRIAR, paramsCriar({ inicio }))).rows[0].id;
      expect(id).toMatch(/^[0-9a-f-]{36}$/);
      const tentativaB = b.query(SQL_CRIAR, paramsCriar({ inicio })).then(
        () => null,
        (e: Error) => e,
      );
      for (let i = 0; ; i += 1) {
        const r = await comoSuperusuario((c) =>
          c.query("select 1 from pg_locks where locktype = 'advisory' and not granted and pid = $1", [pidB]),
        );
        if (r.rowCount) break;
        if (i > 100) throw new Error("B não chegou a esperar a trava");
        await new Promise((ok) => setTimeout(ok, 20));
      }
      await a.query("commit");
      const erro = await tentativaB;
      expect(erro?.message).toBe(MSG_RESERVADO);
      await b.query("rollback");
      const n = await comoSuperusuario((c) =>
        c.query<{ n: number }>("select count(*)::int as n from pedidos_online where inicio = $1", [inicio]),
      );
      expect(n.rows[0].n).toBe(1);
    } finally {
      a.release();
      b.release();
      await comoSuperusuario((c) => c.query("delete from pedidos_online where inicio = $1", [inicio]));
    }
  });

  it("criar_pedido_online: 4º aguardando do mesmo WhatsApp falha; 6º do mesmo ip_hash na hora falha", async () => {
    await comoUsuario(null, async (c) => {
      await comoServico(c);
      const whatsapp = "5511912345678";
      for (const hh of ["09:00", "10:00", "11:00"]) {
        await criar(c, { inicio: hs(SEG1, hh), whatsapp });
      }
      expect((await falha(c, SQL_CRIAR, paramsCriar({ profissional: bia, inicio: hs(SEG1, "09:00"), whatsapp }))).message).toBe(
        MSG_WHATSAPP,
      );

      const ip = "ip-repetido";
      for (const hh of ["09:00", "10:00", "11:00"]) {
        await criar(c, { profissional: bia, inicio: hs(SEG1, hh), ip });
      }
      for (const hh of ["09:00", "10:00"]) {
        await criar(c, { profissional: ana, inicio: hs(SEG2, hh), ip });
      }
      expect((await falha(c, SQL_CRIAR, paramsCriar({ inicio: hs(SEG2, "11:00"), ip }))).message).toBe(MSG_TENTATIVAS);

      // Pedidos com mais de 1 h não contam para o ip_hash; recusados não contam para o WhatsApp.
      await comoSuper(c);
      await c.query("update pedidos_online set criado_em = now() - interval '61 minutes' where ip_hash = $1", [ip]);
      await c.query("update pedidos_online set status = 'recusado' where whatsapp = $1 and inicio = $2", [
        whatsapp,
        hs(SEG1, "09:00"),
      ]);
      await comoServico(c);
      await criar(c, { inicio: hs(SEG2, "11:00"), ip });
      await criar(c, { profissional: ana, inicio: hs(SEG3, "09:00"), whatsapp });
    });
  });

  it("criar_pedido_online sobre pedido vencido → ok (vencido vira expirado)", async () => {
    await comoUsuario(null, async (c) => {
      await comoSuper(c);
      const velho = await pedido(c, { profissional: ana, inicio: hs(SEG1, "09:00"), minutos: 60, idade: "25 hours" });
      await comoServico(c);
      const novo = await criar(c, { inicio: hs(SEG1, "09:00") });
      await comoSuper(c);
      const status = Object.fromEntries(
        (await c.query<{ id: string; status: string }>("select id, status from pedidos_online")).rows.map((l) => [
          l.id,
          l.status,
        ]),
      );
      expect(status).toEqual({ [velho]: "expirado", [novo]: "aguardando" });
    });
  });

  it("criar_pedido_online marca avaliacao=true quando o serviço exige avaliação", async () => {
    await comoUsuario(null, async (c) => {
      await comoServico(c);
      const comAval = await criar(c, { servico: sAval, inicio: hs(SEG1, "09:00") });
      const semAval = await criar(c, { servico: s60, inicio: hs(SEG1, "10:00") });
      await comoSuper(c);
      const r = await c.query(
        `select id, avaliacao, fim = inicio + interval '60 minutes' as fim_ok,
                profissional_id, profissional_escolhida_id, nome, status,
                aceite_privacidade_em = now() as aceite_ok
           from pedidos_online order by inicio`,
      );
      expect(r.rows).toEqual([
        { id: comAval, avaliacao: true, fim_ok: true, profissional_id: ana, profissional_escolhida_id: ana, nome: "Maria Souza", status: "aguardando", aceite_ok: true },
        { id: semAval, avaliacao: false, fim_ok: true, profissional_id: ana, profissional_escolhida_id: ana, nome: "Maria Souza", status: "aguardando", aceite_ok: true },
      ]);
      // Horário fora da grade (11:05) e fora da jornada (11:15 + 60 > 12:00): recusados.
      await comoServico(c);
      expect((await falha(c, SQL_CRIAR, paramsCriar({ inicio: hs(SEG1, "11:05") }))).message).toBe(MSG_RESERVADO);
      expect((await falha(c, SQL_CRIAR, paramsCriar({ inicio: hs(SEG1, "11:15") }))).message).toBe(MSG_RESERVADO);
      // Online desligado.
      await comoSuper(c);
      await c.query("update configuracoes_clinica set online_ativo = false");
      await comoServico(c);
      expect((await falha(c, SQL_CRIAR, paramsCriar({ inicio: hs(SEG1, "11:00") }))).message).toBe(MSG_INDISPONIVEL);
    });
  });

  it("aprovar: cria agendamento confirmado origem online e liga ao pedido; segundo aprovar → \"Este pedido já foi respondido.\"; profissional → recusado; anon não executa", async () => {
    await comoUsuario(recepcao, async (c) => {
      await comoServico(c);
      const p = await criar(c, { inicio: hs(SEG1, "09:00") });
      await logarComo(c, profA);
      expect(
        (await falha(c, SQL_APROVAR, [p, cli, ana, hs(SEG1, "09:00"), hs(SEG1, "10:00"), 20000])).message,
      ).toBe(MSG_PERFIL);
      expect((await falha(c, SQL_RECUSAR, [p, null])).message).toBe(MSG_PERFIL);

      await logarComo(c, recepcao);
      const eu = (await c.query<{ id: string }>("select colaborador_atual_id() as id")).rows[0].id;
      // Aprovada com outra profissional e outro horário.
      const ag = (
        await c.query<{ id: string }>(SQL_APROVAR, [p, cli, bia, hs(SEG1, "10:00"), hs(SEG1, "11:00"), 18000])
      ).rows[0].id;
      const a = (
        await c.query(
          `select cliente_id, profissional_id, servico_id, inicio, fim, status, origem,
                  valor_previsto_centavos, criado_por from agendamentos where id = $1`,
          [ag],
        )
      ).rows[0];
      expect(a).toEqual({
        cliente_id: cli,
        profissional_id: bia,
        servico_id: s60,
        inicio: new Date(hs(SEG1, "10:00")),
        fim: new Date(hs(SEG1, "11:00")),
        status: "confirmado",
        origem: "online",
        valor_previsto_centavos: 18000,
        criado_por: eu,
      });
      const ped = (
        await c.query(
          "select status, agendamento_id, decidido_por, decidido_em = now() as em_ok from pedidos_online where id = $1",
          [p],
        )
      ).rows[0];
      expect(ped).toEqual({ status: "aprovado", agendamento_id: ag, decidido_por: eu, em_ok: true });

      // Duplo toque.
      expect(
        (await falha(c, SQL_APROVAR, [p, cli, bia, hs(SEG1, "10:00"), hs(SEG1, "11:00"), 18000])).message,
      ).toBe(MSG_RESPONDIDO);
      expect((await falha(c, SQL_RECUSAR, [p, null])).message).toBe(MSG_RESPONDIDO);
      expect(
        (await c.query<{ n: number }>("select count(*)::int as n from agendamentos where origem = 'online'")).rows[0].n,
      ).toBe(1);

      // Vencido também conta como respondido.
      await comoSuper(c);
      const velho = await pedido(c, { profissional: ana, inicio: hs(SEG2, "09:00"), minutos: 60, idade: "25 hours" });
      await logarComo(c, dona);
      expect(
        (await falha(c, SQL_APROVAR, [velho, cli, ana, hs(SEG2, "09:00"), hs(SEG2, "10:00"), 20000])).message,
      ).toBe(MSG_RESPONDIDO);
    });
    await comoUsuario(null, (c) =>
      esperarErroSql(
        c.query(SQL_APROVAR, [cli, cli, ana, hs(SEG1, "09:00"), hs(SEG1, "10:00"), 0]),
        "42501",
      ),
    );
    await comoUsuario(null, (c) => esperarErroSql(c.query(SQL_RECUSAR, [cli, null]), "42501"));
  });

  it("aprovar/recusar pedido já respondido não esperam a trava da agenda (linha antes da trava)", async () => {
    const inicio = hs(SEG3, "10:00");
    const p = await comoSuperusuario((c) =>
      pedido(c, { profissional: ana, inicio, minutos: 60, status: "recusado" }),
    );
    const a = await abrirConexao(null);
    const b = await abrirConexao(recepcao);
    try {
      await a.query("reset role");
      await a.query("begin");
      await a.query("select pg_advisory_xact_lock(hashtext('agenda:' || $1::text))", [ana]);
      await b.query("set statement_timeout = '1s'");
      const e1 = await esperarErroSql(
        b.query(SQL_APROVAR, [p, cli, ana, inicio, hs(SEG3, "11:00"), 20000]),
        "P0001",
      );
      expect(e1.message).toBe(MSG_RESPONDIDO);
      const e2 = await esperarErroSql(b.query(SQL_RECUSAR, [p, null]), "P0001");
      expect(e2.message).toBe(MSG_RESPONDIDO);
      await a.query("rollback");
    } finally {
      a.release(true);
      b.release(true);
      await comoSuperusuario((c) => c.query("delete from pedidos_online where id = $1", [p]));
    }
  });

  it("criar_pedido_online trava por WhatsApp e por ip_hash antes de contar os limites", async () => {
    const a = await abrirConexao(null);
    const b = await abrirConexao(null);
    try {
      await a.query("reset role");
      await b.query("reset role");
      await b.query("set role service_role");
      await b.query("set statement_timeout = '500ms'");
      for (const chave of ["online:wa:5511955550000", "online:ip:ip-travado"]) {
        await a.query("begin");
        await a.query("select pg_advisory_xact_lock(hashtext($1))", [chave]);
        const params = paramsCriar({
          inicio: hs(SEG3, "11:00"),
          ...(chave.startsWith("online:wa:") ? { whatsapp: "5511955550000" } : { ip: "ip-travado" }),
        });
        // Com a outra transação segurando a trava, criar espera (e estoura o timeout).
        await esperarErroSql(b.query(SQL_CRIAR, params), "57014");
        await a.query("rollback");
      }
    } finally {
      a.release(true);
      b.release(true);
      await comoSuperusuario((c) => c.query("delete from pedidos_online where inicio = $1", [hs(SEG3, "11:00")]));
    }
  });

  it("aprovar para horário com agendamento existente → 23P01 e pedido continua aguardando", async () => {
    await comoUsuario(recepcao, async (c) => {
      await comoSuper(c);
      await agendar(c, ana, hs(SEG1, "11:00"));
      await comoServico(c);
      const p = await criar(c, { inicio: hs(SEG1, "09:00") });
      await logarComo(c, recepcao);
      await falha(c, SQL_APROVAR, [p, cli, ana, hs(SEG1, "10:30"), hs(SEG1, "11:30"), 20000], "23P01");
      const r = (await c.query("select status, agendamento_id from pedidos_online where id = $1", [p])).rows[0];
      expect(r).toEqual({ status: "aguardando", agendamento_id: null });
    });
  });

  it("recusar libera o horário (novo pedido no mesmo horário passa)", async () => {
    await comoUsuario(dona, async (c) => {
      await comoServico(c);
      const p = await criar(c, { inicio: hs(SEG1, "09:00") });
      const outro = await criar(c, { inicio: hs(SEG1, "10:00") });
      expect((await falha(c, SQL_CRIAR, paramsCriar({ inicio: hs(SEG1, "09:00") }))).message).toBe(MSG_RESERVADO);
      await logarComo(c, dona);
      const eu = (await c.query<{ id: string }>("select colaborador_atual_id() as id")).rows[0].id;
      await c.query(SQL_RECUSAR, [p, "  Sem horário nesse dia.  "]);
      await c.query(SQL_RECUSAR, [outro, "   "]);
      const r = (
        await c.query(
          "select id, status, motivo_recusa, decidido_por, decidido_em = now() as em_ok from pedidos_online order by inicio",
        )
      ).rows;
      expect(r).toEqual([
        { id: p, status: "recusado", motivo_recusa: "Sem horário nesse dia.", decidido_por: eu, em_ok: true },
        { id: outro, status: "recusado", motivo_recusa: null, decidido_por: eu, em_ok: true },
      ]);
      expect((await falha(c, SQL_RECUSAR, [p, null])).message).toBe(MSG_RESPONDIDO);
      await comoServico(c);
      await criar(c, { inicio: hs(SEG1, "09:00") });
    });
  });
});
