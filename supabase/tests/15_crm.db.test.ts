import type { PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  comoSuperusuario,
  comoUsuario,
  contar,
  criarUsuario,
  criarUsuarioSemColaborador,
  esperarErroSql,
  fecharConexoes,
  resetarBanco,
} from "./helpers";

// 0014/0015 (seção 1): tipos novos de mensagem, modelos retorno/reativação,
// leads (RLS, gatilhos), crm_retornos, crm_sumidas, crm_indicadores e
// converter_lead.

const MSG_CRM = "Apenas a dona ou a recepção podem usar o CRM.";
const MSG_INDICADORES = "Apenas a dona vê os indicadores.";
const MSG_JA_CLIENTE = "Este lead já virou cliente.";
const MSG_LGPD = "Confirme o aceite da LGPD.";

let dona: string;
let recepcao: string;
let prof: string;
let semColaborador: string;
let profId: string;
let servico30: string;
let servico1: string;
let servicoSem: string;

async function comoSuper(c: PoolClient) {
  await c.query("reset role");
  await c.query("select set_config('request.jwt.claims', '', true)");
}

async function logarComo(c: PoolClient, uid: string) {
  await c.query("set local role authenticated");
  await c.query("select set_config('request.jwt.claims', $1, true)", [
    JSON.stringify({ sub: uid, role: "authenticated" }),
  ]);
}

/** Executa `fn` como `uid` e volta a superusuário. */
async function como<T>(c: PoolClient, uid: string, fn: () => Promise<T>): Promise<T> {
  await logarComo(c, uid);
  try {
    return await fn();
  } finally {
    await comoSuper(c);
  }
}

/** Espera o erro sem abortar a transação (savepoint). */
async function falha(c: PoolClient, sql: string, params: unknown[], sqlstate = "P0001") {
  await c.query("savepoint tentativa");
  const erro = await esperarErroSql(c.query(sql, params), sqlstate);
  await c.query("rollback to savepoint tentativa");
  return erro;
}

/** Transação desfeita ao final, como superusuário. */
function emTeste<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  return comoUsuario(dona, async (c) => {
    await comoSuper(c);
    return fn(c);
  });
}

let seq = 0;
/** WhatsApp único por chamada. */
function zap(): string {
  seq += 1;
  return `55119${String(70000000 + seq).padStart(8, "0")}`;
}

async function novaCliente(
  c: PoolClient,
  p: { nome?: string; whatsapp?: string | null; marketing?: boolean; ativo?: boolean } = {},
): Promise<string> {
  const r = await c.query<{ id: string }>(
    `insert into clientes (nome, whatsapp, aceite_lgpd_em, aceita_whatsapp_marketing, ativo)
     values ($1, $2, now(), $3, $4) returning id`,
    [
      p.nome ?? "Cliente",
      p.whatsapp === undefined ? zap() : p.whatsapp,
      p.marketing ?? true,
      p.ativo ?? true,
    ],
  );
  return r.rows[0].id;
}

/** Agendamento com início `inicio` (timestamptz literal ou expressão via `daqui`). */
async function agendar(
  c: PoolClient,
  p: { cliente: string; servico: string; status: string; inicio?: string; daqui?: string },
): Promise<string> {
  const inicio =
    p.inicio ??
    (
      await c.query<{ t: string }>("select (now() + $1::interval)::text as t", [p.daqui ?? "0"])
    ).rows[0].t;
  const r = await c.query<{ id: string }>(
    `insert into agendamentos (cliente_id, profissional_id, servico_id, inicio, fim, status)
     values ($1, $2, $3, $4::timestamptz, $4::timestamptz + interval '30 minutes', $5)
     returning id`,
    [p.cliente, profId, p.servico, inicio, p.status],
  );
  return r.rows[0].id;
}

type Retorno = {
  cliente_id: string;
  cliente_nome: string;
  whatsapp: string | null;
  aceita_marketing: boolean;
  servico_id: string;
  servico_nome: string;
  agendamento_id: string;
  ultimo_atendimento: Date;
  data_retorno: string;
  retorno_enviado_em: Date | null;
};

async function retornos(c: PoolClient, ate: string, uid = recepcao): Promise<Retorno[]> {
  return como(c, uid, async () =>
    (
      await c.query<Retorno>(
        "select *, data_retorno::text as data_retorno from crm_retornos($1::date)",
        [ate],
      )
    ).rows,
  );
}

type Sumida = {
  cliente_id: string;
  nome: string;
  whatsapp: string | null;
  aceita_marketing: boolean;
  ultimo_atendimento: Date;
  dias_sem_vir: number;
  reativacao_enviada_em: Date | null;
};

async function sumidas(c: PoolClient, uid = recepcao): Promise<Sumida[]> {
  return como(c, uid, async () => (await c.query<Sumida>("select * from crm_sumidas()")).rows);
}

async function novoLead(
  c: PoolClient,
  p: { nome?: string; whatsapp?: string | null; origem?: string | null; etapa?: string } = {},
): Promise<string> {
  const r = await c.query<{ id: string }>(
    `insert into leads (nome, whatsapp, origem, etapa) values ($1, $2, $3, coalesce($4, 'novo')::etapa_lead)
     returning id`,
    [p.nome ?? "Lead", p.whatsapp === undefined ? zap() : p.whatsapp, p.origem ?? null, p.etapa ?? null],
  );
  return r.rows[0].id;
}

beforeAll(async () => {
  await resetarBanco();
  ({ uid: dona } = await criarUsuario("dona"));
  ({ uid: recepcao } = await criarUsuario("recepcao"));
  ({ uid: prof, colaboradorId: profId } = await criarUsuario("profissional", { nome: "Ana" }));
  semColaborador = await criarUsuarioSemColaborador();

  await comoSuperusuario(async (c) => {
    await c.query("insert into configuracoes_clinica (nome) values ('Madame Fé')");
    const cat = await c.query<{ id: string }>(
      "insert into categorias_servico (nome) values ('Facial') returning id",
    );
    const servico = async (nome: string, dias: number | null) =>
      (
        await c.query<{ id: string }>(
          `insert into servicos (nome, categoria_id, duracao_min, preco_centavos, dias_retorno)
           values ($1, $2, 30, 20000, $3) returning id`,
          [nome, cat.rows[0].id, dias],
        )
      ).rows[0].id;
    servico30 = await servico("Botox", 30);
    servico1 = await servico("Retoque", 1);
    servicoSem = await servico("Limpeza de pele", null);
  });
});

afterAll(fecharConexoes);

describe("estrutura", () => {
  it("enums, modelos novos e permissões das funções", async () => {
    const r = await comoSuperusuario(async (c) => {
      const t = await c.query("select enum_range(null::tipo_mensagem)::text[] as v");
      const e = await c.query("select enum_range(null::etapa_lead)::text[] as v");
      const m = await c.query<{ tipo: string; v: string; ativo: boolean }>(
        `select tipo::text, variacoes[1] as v, ativo from modelos_mensagem
         where tipo in ('retorno', 'reativacao') order by tipo::text desc`,
      );
      const f = await c.query(
        `select p.proname, has_function_privilege('authenticated', p.oid, 'execute') as auth,
                has_function_privilege('anon', p.oid, 'execute') as anon,
                p.prosecdef as definer,
                coalesce(array_to_string(p.proconfig, ','), '') as config
         from pg_proc p
         where p.pronamespace = 'public'::regnamespace
           and p.proname in ('crm_retornos', 'crm_sumidas', 'crm_indicadores', 'converter_lead',
                             'exigir_equipe_crm', 'leads_proteger', 'crm_origens_retorno',
                             'cliente_tem_agendamento_futuro')
         order by p.proname`,
      );
      return { t: t.rows[0].v, e: e.rows[0].v, m: m.rows, f: f.rows };
    });
    expect(r.t).toEqual(expect.arrayContaining(["retorno", "reativacao"]));
    expect(r.e).toEqual(["novo", "em_conversa", "orcamento_enviado", "agendou", "perdido"]);
    expect(r.m).toEqual([
      {
        tipo: "retorno",
        ativo: true,
        v: "Oi, {nome}! Já está na hora de renovar seu {servico}. Quer que a gente reserve um horário para você? {clinica}",
      },
      {
        tipo: "reativacao",
        ativo: true,
        v: "Oi, {nome}! Sentimos sua falta aqui na {clinica}. Que tal agendar um momento para você? É só responder esta mensagem.",
      },
    ]);
    const pub = { auth: true, anon: false, definer: true, config: "search_path=\"\"" };
    const interna = { auth: false, anon: false, definer: true, config: "search_path=\"\"" };
    expect(r.f).toEqual([
      { proname: "cliente_tem_agendamento_futuro", ...interna },
      { proname: "converter_lead", ...pub },
      { proname: "crm_indicadores", ...pub },
      { proname: "crm_origens_retorno", ...interna },
      { proname: "crm_retornos", ...pub },
      { proname: "crm_sumidas", ...pub },
      { proname: "exigir_equipe_crm", ...interna },
      { proname: "leads_proteger", auth: false, anon: false, definer: false, config: "search_path=\"\"" },
    ]);
  });
});

describe("crm_retornos", () => {
  it("usa só o atendimento mais recente do serviço", async () => {
    await emTeste(async (c) => {
      const cli = await novaCliente(c, { nome: "Maria" });
      await agendar(c, { cliente: cli, servico: servico30, status: "atendido", inicio: "2026-08-01 10:00-03" });
      const recente = await agendar(c, {
        cliente: cli,
        servico: servico30,
        status: "atendido",
        inicio: "2026-10-20 10:00-03",
      });
      const r = (await retornos(c, "2026-11-26")).filter((l) => l.cliente_id === cli);
      expect(r).toHaveLength(1);
      expect(r[0]).toMatchObject({
        agendamento_id: recente,
        servico_id: servico30,
        servico_nome: "Botox",
        cliente_nome: "Maria",
        aceita_marketing: true,
        data_retorno: "2026-11-19",
        retorno_enviado_em: null,
      });
      expect(r[0].ultimo_atendimento.toISOString()).toBe("2026-10-20T13:00:00.000Z");
    });
  });

  it("data do retorno pelo dia em São Paulo (virada do mês)", async () => {
    await emTeste(async (c) => {
      const cli = await novaCliente(c);
      await agendar(c, { cliente: cli, servico: servico1, status: "atendido", inicio: "2026-10-31 23:30-03" });
      const r = (await retornos(c, "2026-11-26")).filter((l) => l.cliente_id === cli);
      expect(r.map((l) => l.data_retorno)).toEqual(["2026-11-01"]);
    });
  });

  it("p_ate antes da data do retorno → fora; ordem por data", async () => {
    await emTeste(async (c) => {
      const a = await novaCliente(c, { nome: "Bia" });
      const b = await novaCliente(c, { nome: "Ana" });
      await agendar(c, { cliente: a, servico: servico30, status: "atendido", inicio: "2026-10-20 10:00-03" });
      await agendar(c, { cliente: b, servico: servico1, status: "atendido", inicio: "2026-10-31 10:00-03" });
      expect(
        (await retornos(c, "2026-11-18")).filter((l) => [a, b].includes(l.cliente_id)).map((l) => l.cliente_id),
      ).toEqual([b]);
      expect(
        (await retornos(c, "2026-11-19")).filter((l) => [a, b].includes(l.cliente_id)).map((l) => l.cliente_id),
      ).toEqual([b, a]);
    });
  });

  it("agendamento futuro pendente tira a cliente; cancelado não", async () => {
    await emTeste(async (c) => {
      const cli = await novaCliente(c);
      await agendar(c, { cliente: cli, servico: servico30, status: "atendido", inicio: "2026-10-20 10:00-03" });
      const futuro = await agendar(c, { cliente: cli, servico: servicoSem, status: "pendente", daqui: "3 days" });
      expect((await retornos(c, "2026-11-26")).filter((l) => l.cliente_id === cli)).toHaveLength(0);
      await c.query("update agendamentos set status = 'cancelado' where id = $1", [futuro]);
      expect((await retornos(c, "2026-11-26")).filter((l) => l.cliente_id === cli)).toHaveLength(1);
    });
  });

  it("serviço sem dias_retorno nunca aparece", async () => {
    await emTeste(async (c) => {
      const cli = await novaCliente(c);
      await agendar(c, { cliente: cli, servico: servicoSem, status: "atendido", inicio: "2026-01-10 10:00-03" });
      expect((await retornos(c, "2030-01-01")).filter((l) => l.cliente_id === cli)).toHaveLength(0);
    });
  });

  it("cliente inativa fica fora; agendamento não atendido não é origem", async () => {
    await emTeste(async (c) => {
      const inativa = await novaCliente(c, { ativo: false });
      await agendar(c, { cliente: inativa, servico: servico30, status: "atendido", inicio: "2026-10-20 10:00-03" });
      const faltou = await novaCliente(c);
      await agendar(c, { cliente: faltou, servico: servico30, status: "faltou", inicio: "2026-10-20 11:00-03" });
      const r = await retornos(c, "2026-11-26");
      expect(r.filter((l) => [inativa, faltou].includes(l.cliente_id))).toHaveLength(0);
    });
  });
});

describe("crm_sumidas", () => {
  it("mais de dias_cliente_sumida sem atendimento; exclusões", async () => {
    await emTeste(async (c) => {
      await c.query("update configuracoes_clinica set dias_cliente_sumida = 90");
      const h91 = await novaCliente(c, { nome: "Há 91" });
      await agendar(c, { cliente: h91, servico: servicoSem, status: "atendido", daqui: "-91 days" });
      const h89 = await novaCliente(c, { nome: "Há 89" });
      await agendar(c, { cliente: h89, servico: servicoSem, status: "atendido", daqui: "-89 days" });
      const nunca = await novaCliente(c, { nome: "Nunca" });
      await agendar(c, { cliente: nunca, servico: servicoSem, status: "faltou", daqui: "-200 days" });
      const comFuturo = await novaCliente(c, { nome: "Com futuro" });
      await agendar(c, { cliente: comFuturo, servico: servicoSem, status: "atendido", daqui: "-120 days" });
      await agendar(c, { cliente: comFuturo, servico: servicoSem, status: "confirmado", daqui: "5 days" });
      const h150 = await novaCliente(c, { nome: "Há 150", marketing: false });
      await agendar(c, { cliente: h150, servico: servicoSem, status: "atendido", daqui: "-150 days" });
      await agendar(c, { cliente: h150, servico: servicoSem, status: "atendido", daqui: "-300 days" });

      const r = (await sumidas(c)).filter((l) =>
        [h91, h89, nunca, comFuturo, h150].includes(l.cliente_id),
      );
      expect(r.map((l) => [l.nome, l.dias_sem_vir, l.aceita_marketing])).toEqual([
        ["Há 150", 150, false],
        ["Há 91", 91, true],
      ]);
      expect(r[1].reativacao_enviada_em).toBeNull();
    });
  });
});

describe("crm_indicadores", () => {
  it("contagens batem; recepção não vê", async () => {
    await emTeste(async (c) => {
      // Sem dados de outros testes (tudo desfeito); conta só o que está aqui.
      const ret = await novaCliente(c);
      await agendar(c, { cliente: ret, servico: servico30, status: "atendido", daqui: "-25 days" });
      const atrasada = await novaCliente(c);
      await agendar(c, { cliente: atrasada, servico: servico30, status: "atendido", daqui: "-60 days" });
      const longe = await novaCliente(c);
      await agendar(c, { cliente: longe, servico: servico30, status: "atendido", daqui: "-5 days" });
      const sumida = await novaCliente(c);
      await agendar(c, { cliente: sumida, servico: servicoSem, status: "atendido", daqui: "-100 days" });
      for (const etapa of ["novo", "em_conversa", "orcamento_enviado", "agendou", "perdido"]) {
        await novoLead(c, { etapa });
      }
      const conv = await novoLead(c, { etapa: "agendou" });
      await como(c, recepcao, () => c.query("select converter_lead($1, true, false)", [conv]));

      const r = await como(c, dona, async () => (await c.query("select * from crm_indicadores()")).rows);
      // ret (hoje+5) e atrasada (hoje−30) entram; longe (hoje+25) não.
      expect(r).toEqual([{ retornos: 2, sumidas: 1, leads_abertos: 3, convertidos_mes: 1 }]);

      await logarComo(c, recepcao);
      const e = await falha(c, "select * from crm_indicadores()", []);
      expect(e.message).toBe(MSG_INDICADORES);
      await comoSuper(c);
    });
  });
});

describe("leads", () => {
  it("recepção cria e move; profissional nada; ninguém apaga; cliente_id não muda direto", async () => {
    await emTeste(async (c) => {
      const id = await como(c, recepcao, async () => {
        const r = await c.query<{ id: string; etapa: string; criado_por: string | null }>(
          `insert into leads (nome, whatsapp, origem, observacoes)
           values ('Carla', '5511988887777', 'instagram', 'Quer botox') returning id, etapa::text, criado_por`,
        );
        expect(r.rows[0].etapa).toBe("novo");
        expect(r.rows[0].criado_por).not.toBeNull();
        const u = await c.query("update leads set etapa = 'em_conversa' where id = $1", [r.rows[0].id]);
        expect(u.rowCount).toBe(1);
        return r.rows[0].id;
      });

      await como(c, prof, async () => {
        expect(await contar(c, "leads")).toBe(0);
        await falha(c, "insert into leads (nome) values ('X')", [], "42501");
        const u = await c.query("update leads set nome = 'Y' where id = $1", [id]);
        expect(u.rowCount).toBe(0);
      });

      for (const uid of [dona, recepcao]) {
        await como(c, uid, async () => {
          await falha(c, "delete from leads where id = $1", [id], "42501");
        });
      }

      const cli = await novaCliente(c);
      await como(c, dona, async () => {
        await falha(c, "update leads set cliente_id = $2 where id = $1", [id, cli], "42501");
        await falha(c, "update leads set convertido_em = now() where id = $1", [id], "42501");
      });
      // Mesmo sem o filtro de colunas (superusuário), o gatilho recusa.
      await falha(c, "update leads set cliente_id = $2, convertido_em = now() where id = $1", [id, cli]);
      await falha(
        c,
        "insert into leads (nome, cliente_id, convertido_em) values ('Z', $1, now())",
        [cli],
      );
      const conv = await como(c, recepcao, async () =>
        (await c.query<{ id: string }>("select converter_lead($1, true, false) as id", [id])).rows[0].id,
      );
      expect(conv).toBeTruthy();
      const e = await falha(c, "update leads set cliente_id = null, convertido_em = null where id = $1", [id]);
      expect(e.message).toBe(MSG_JA_CLIENTE);
    });
  });

  it("anon não lê nem cria", async () => {
    await comoUsuario(null, async (c) => {
      await falha(c, "select * from leads", [], "42501");
    });
  });

  it("checks: nome 1–120, whatsapp, origem, motivo ≤ 200", async () => {
    await emTeste(async (c) => {
      await falha(c, "insert into leads (nome) values ('  ')", [], "23514");
      await falha(c, "insert into leads (nome) values (repeat('a', 121))", [], "23514");
      await falha(c, "insert into leads (nome, whatsapp) values ('A', '11999999999')", [], "23514");
      await falha(c, "insert into leads (nome, origem) values ('A', 'tiktok')", [], "23514");
      await falha(
        c,
        "insert into leads (nome, etapa, perdido_motivo) values ('A', 'perdido', repeat('a', 201))",
        [],
        "23514",
      );
      await falha(c, "insert into leads (nome, observacoes) values ('A', repeat('a', 2001))", [], "23514");
    });
  });

  it("motivo da perda: guardado em perdido, limpo ao sair", async () => {
    await emTeste(async (c) => {
      const id = await novoLead(c);
      await como(c, recepcao, async () => {
        await c.query("update leads set etapa = 'perdido', perdido_motivo = 'Achou caro' where id = $1", [id]);
        const p = await c.query("select etapa::text, perdido_motivo from leads where id = $1", [id]);
        expect(p.rows[0]).toEqual({ etapa: "perdido", perdido_motivo: "Achou caro" });
        await c.query("update leads set etapa = 'em_conversa' where id = $1", [id]);
        const v = await c.query("select etapa::text, perdido_motivo from leads where id = $1", [id]);
        expect(v.rows[0]).toEqual({ etapa: "em_conversa", perdido_motivo: null });
      });
    });
  });
});

describe("converter_lead", () => {
  it("sem cliente com o mesmo WhatsApp → cria a cliente", async () => {
    await emTeste(async (c) => {
      const whats = zap();
      const lead = await novoLead(c, { nome: "Paula Lima", whatsapp: whats, origem: "indicacao", etapa: "orcamento_enviado" });
      const antes = await contar(c, "clientes");
      const cli = await como(c, recepcao, async () =>
        (await c.query<{ id: string }>("select converter_lead($1, true, true) as id", [lead])).rows[0].id,
      );
      expect(await contar(c, "clientes")).toBe(antes + 1);
      const nova = await c.query(
        `select nome, whatsapp, origem, aceita_whatsapp_marketing, aceite_lgpd_em is not null as lgpd, ativo
         from clientes where id = $1`,
        [cli],
      );
      expect(nova.rows[0]).toEqual({
        nome: "Paula Lima",
        whatsapp: whats,
        origem: "indicacao",
        aceita_whatsapp_marketing: true,
        lgpd: true,
        ativo: true,
      });
      const l = await c.query(
        "select cliente_id, convertido_em is not null as conv, etapa::text from leads where id = $1",
        [lead],
      );
      expect(l.rows[0]).toEqual({ cliente_id: cli, conv: true, etapa: "orcamento_enviado" });

      // Opt-in conforme o parâmetro.
      const outro = await novoLead(c);
      const cli2 = await como(c, dona, async () =>
        (await c.query<{ id: string }>("select converter_lead($1, true, false) as id", [outro])).rows[0].id,
      );
      const o = await c.query("select aceita_whatsapp_marketing from clientes where id = $1", [cli2]);
      expect(o.rows[0].aceita_whatsapp_marketing).toBe(false);
    });
  });

  it("WhatsApp de uma cliente existente → liga a ela, sem criar outra", async () => {
    await emTeste(async (c) => {
      const whats = zap();
      const existente = await novaCliente(c, { nome: "Já Cliente", whatsapp: whats, marketing: false });
      const aceite = "2025-01-10T12:00:00Z";
      await c.query("update clientes set aceite_lgpd_em = $2 where id = $1", [existente, aceite]);
      const lead = await novoLead(c, { nome: "Outro nome", whatsapp: whats });
      const antes = await contar(c, "clientes");
      const cli = await como(c, recepcao, async () =>
        (await c.query<{ id: string }>("select converter_lead($1, true, true) as id", [lead])).rows[0].id,
      );
      expect(cli).toBe(existente);
      expect(await contar(c, "clientes")).toBe(antes);
      const l = await c.query("select cliente_id from leads where id = $1", [lead]);
      expect(l.rows[0].cliente_id).toBe(existente);
      // A cliente existente não muda: opt-in e aceite LGPD já gravado ficam como estavam.
      const e = await c.query(
        "select aceita_whatsapp_marketing, aceite_lgpd_em = $2::timestamptz as mesmo_aceite from clientes where id = $1",
        [existente, aceite],
      );
      expect(e.rows[0]).toEqual({ aceita_whatsapp_marketing: false, mesmo_aceite: true });
    });
  });

  it("erros: já convertido, sem aceite LGPD, lead inexistente", async () => {
    await emTeste(async (c) => {
      const lead = await novoLead(c);
      const outro = await novoLead(c);
      await logarComo(c, recepcao);
      await c.query("select converter_lead($1, true, false)", [lead]);
      expect((await falha(c, "select converter_lead($1, true, false)", [lead])).message).toBe(MSG_JA_CLIENTE);
      expect((await falha(c, "select converter_lead($1, false, false)", [outro])).message).toBe(MSG_LGPD);
      expect((await falha(c, "select converter_lead($1, null, false)", [outro])).message).toBe(MSG_LGPD);
      expect(
        (await falha(c, "select converter_lead(gen_random_uuid(), true, false)", [])).message,
      ).toBe("Lead não encontrado.");
      await comoSuper(c);
      const l = await c.query("select cliente_id from leads where id = $1", [outro]);
      expect(l.rows[0].cliente_id).toBeNull();
    });
  });
});

describe("perfil", () => {
  it("profissional (e usuário sem colaborador) não usa as funções do CRM", async () => {
    await emTeste(async (c) => {
      const lead = await novoLead(c);
      for (const uid of [prof, semColaborador]) {
        await logarComo(c, uid);
        for (const sql of [
          "select * from crm_retornos('2026-11-26')",
          "select * from crm_sumidas()",
          "select converter_lead($1, true, false)",
        ]) {
          const e = await falha(c, sql, sql.includes("$1") ? [lead] : []);
          expect(e.message).toBe(MSG_CRM);
        }
        expect((await falha(c, "select * from crm_indicadores()", [])).message).toBe(MSG_INDICADORES);
        await comoSuper(c);
      }
    });
  });

  it("anon não executa", async () => {
    await comoUsuario(null, async (c) => {
      await falha(c, "select * from crm_sumidas()", [], "42501");
    });
  });
});
