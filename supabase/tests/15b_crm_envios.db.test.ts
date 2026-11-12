import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  comoSuperusuario,
  comoUsuario,
  criarUsuario,
  esperarErroSql,
  fecharConexoes,
  resetarBanco,
} from "./helpers";

// 0015 (seção 2): fila_mensagens.lead_id, um retorno por origem,
// enviar_retorno, enviar_reativacao, enviar_avulsa_lead,
// enfileirar_retornos_do_dia / enfileirar_retornos e as regras de retorno e
// reativação em proxima_mensagem.

const MSG_CRM = "Apenas a dona ou a recepção podem usar o CRM.";
const MSG_SEM_WHATS = "Esta cliente não tem WhatsApp cadastrado.";
const MSG_SEM_OPTIN = "A cliente não aceitou mensagens de marketing.";
const MSG_RETORNO_DUPLICADO = "Já existe um retorno na fila para este atendimento.";
const MSG_SEM_RETORNO = "Este atendimento não tem retorno.";
const MSG_LOTE_VAZIO = "Escolha pelo menos uma cliente.";
const MSG_LOTE_GRANDE = "Escolha no máximo 500 clientes.";
const MSG_LEAD_SEM_WHATS = "Este lead não tem WhatsApp cadastrado.";
const MSG_VAZIA = "Escreva a mensagem.";

let dona: string;
let recepcao: string;
let recepcaoId: string;
let prof: string;
let profId: string;
let servico30: string;
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

async function comoServico(c: PoolClient) {
  await c.query("set local role service_role");
  await c.query("select set_config('request.jwt.claims', $1, true)", [
    JSON.stringify({ role: "service_role" }),
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
function zap(): string {
  seq += 1;
  return `55119${String(60000000 + seq).padStart(8, "0")}`;
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

async function agendar(
  c: PoolClient,
  p: { cliente: string; servico?: string; status: string; inicio?: string; daqui?: string },
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
    [p.cliente, profId, p.servico ?? servico30, inicio, p.status],
  );
  return r.rows[0].id;
}

/** Liga o envio com janela que cobre o dia todo. */
async function configurar(c: PoolClient) {
  await c.query(
    `update configuracoes_clinica set whatsapp_ativo = true, whatsapp_janela_inicio = '00:00',
       whatsapp_janela_fim = '23:59:59.999999', whatsapp_limite_por_hora = 60`,
  );
}

type Proxima = {
  id: string;
  tipo: string;
  telefone: string;
  texto: string | null;
  variacoes: string[] | null;
  nome: string | null;
  servico: string | null;
};

async function proxima(c: PoolClient): Promise<Proxima[]> {
  await comoServico(c);
  const r = await c.query<Proxima>("select * from proxima_mensagem()");
  await comoSuper(c);
  return r.rows;
}

type Msg = {
  tipo: string;
  status: string;
  cliente_id: string | null;
  lead_id: string | null;
  agendamento_id: string | null;
  telefone: string;
  texto: string | null;
  agendado_para: Date;
  cancelada_motivo: string | null;
  criado_por: string | null;
};

async function msg(c: PoolClient, id: string): Promise<Msg> {
  return (
    await c.query<Msg>(
      `select tipo::text, status::text, cliente_id, lead_id, agendamento_id, telefone, texto,
              agendado_para, cancelada_motivo, criado_por
       from fila_mensagens where id = $1`,
      [id],
    )
  ).rows[0];
}

/** Superusuário: retorno/reativação pendente agendado há `ha`. */
async function naFila(
  c: PoolClient,
  p: { tipo: "retorno" | "reativacao"; cliente: string; agendamento?: string; ha?: string },
): Promise<string> {
  const r = await c.query<{ id: string }>(
    `insert into fila_mensagens (tipo, cliente_id, agendamento_id, telefone, agendado_para)
     select $1::tipo_mensagem, c.id, $3, c.whatsapp, now() - $4::interval
     from clientes c where c.id = $2 returning id`,
    [p.tipo, p.cliente, p.agendamento ?? null, p.ha ?? "1 minute"],
  );
  return r.rows[0].id;
}

async function filaDoTipo(c: PoolClient, tipo: string, clientes: string[]) {
  return (
    await c.query<{ cliente_id: string; agendamento_id: string | null; agendado_para: Date; status: string }>(
      `select cliente_id, agendamento_id, agendado_para, status::text from fila_mensagens
       where tipo = $1::tipo_mensagem and cliente_id = any($2::uuid[]) order by agendado_para, criado_em`,
      [tipo, clientes],
    )
  ).rows;
}

beforeAll(async () => {
  await resetarBanco();
  ({ uid: dona } = await criarUsuario("dona"));
  ({ uid: recepcao, colaboradorId: recepcaoId } = await criarUsuario("recepcao"));
  ({ uid: prof, colaboradorId: profId } = await criarUsuario("profissional", { nome: "Ana" }));

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
    servicoSem = await servico("Limpeza de pele", null);
  });
});

afterAll(fecharConexoes);

describe("estrutura e permissões", () => {
  it("execute só para quem deve", async () => {
    const f = await comoSuperusuario(async (c) =>
      (
        await c.query(
          `select p.proname, has_function_privilege('authenticated', p.oid, 'execute') as auth,
                  has_function_privilege('anon', p.oid, 'execute') as anon,
                  has_function_privilege('service_role', p.oid, 'execute') as service,
                  p.prosecdef as definer
           from pg_proc p
           where p.pronamespace = 'public'::regnamespace
             and p.proname in ('enviar_retorno', 'enviar_reativacao', 'enviar_avulsa_lead',
                               'enfileirar_retornos_do_dia', 'enfileirar_retornos')
           order by p.proname`,
        )
      ).rows,
    );
    const pub = { auth: true, anon: false, service: true, definer: true };
    const nada = { auth: false, anon: false, service: false, definer: true };
    expect(f).toEqual([
      { proname: "enfileirar_retornos", ...nada },
      { proname: "enfileirar_retornos_do_dia", ...nada },
      { proname: "enviar_avulsa_lead", ...pub },
      { proname: "enviar_reativacao", ...pub },
      { proname: "enviar_retorno", ...pub },
    ]);
  });

  it("profissional não executa as três; authenticated não executa o job", async () => {
    await emTeste(async (c) => {
      const cli = await novaCliente(c);
      const ag = await agendar(c, { cliente: cli, status: "atendido", daqui: "-20 days" });
      const lead = (
        await c.query<{ id: string }>("insert into leads (nome, whatsapp) values ('L', $1) returning id", [zap()])
      ).rows[0].id;
      await logarComo(c, prof);
      expect((await falha(c, "select enviar_retorno($1)", [ag])).message).toBe(MSG_CRM);
      expect((await falha(c, "select * from enviar_reativacao($1::uuid[])", [[cli]])).message).toBe(MSG_CRM);
      expect((await falha(c, "select enviar_avulsa_lead($1, 'Oi')", [lead])).message).toBe(MSG_CRM);
      for (const uid of [dona, recepcao]) {
        await logarComo(c, uid);
        await falha(c, "select enfileirar_retornos_do_dia('2026-11-20')", [], "42501");
        await falha(c, "select enfileirar_retornos()", [], "42501");
      }
      await comoSuper(c);
      expect((await c.query("select count(*)::int as n from fila_mensagens where tipo in ('retorno', 'reativacao')")).rows[0].n).toBe(0);
    });
  });

  it("lead_id só em avulsa sem cliente; um retorno por origem (cancelada/falhou não contam)", async () => {
    await emTeste(async (c) => {
      const cli = await novaCliente(c);
      const ag = await agendar(c, { cliente: cli, status: "atendido", daqui: "-20 days" });
      const lead = (
        await c.query<{ id: string }>("insert into leads (nome, whatsapp) values ('L', $1) returning id", [zap()])
      ).rows[0].id;
      await falha(
        c,
        `insert into fila_mensagens (tipo, lead_id, telefone, agendado_para) values ('retorno', $1, '5511999999999', now())`,
        [lead],
        "23514",
      );
      await falha(
        c,
        `insert into fila_mensagens (tipo, lead_id, cliente_id, telefone, texto, agendado_para)
         values ('avulsa', $1, $2, '5511999999999', 'x', now())`,
        [lead, cli],
        "23514",
      );
      const a = await naFila(c, { tipo: "retorno", cliente: cli, agendamento: ag });
      await falha(
        c,
        "insert into fila_mensagens (tipo, cliente_id, agendamento_id, telefone, agendado_para) values ('retorno', $1, $2, '5511999999999', now())",
        [cli, ag],
        "23505",
      );
      await c.query("update fila_mensagens set status = 'falhou' where id = $1", [a]);
      await naFila(c, { tipo: "retorno", cliente: cli, agendamento: ag });
    });
  });
});

describe("enviar_retorno", () => {
  it("erros: sem opt-in, sem WhatsApp, duplicado, origem sem retorno", async () => {
    await emTeste(async (c) => {
      const semOptin = await novaCliente(c, { marketing: false });
      const agSemOptin = await agendar(c, { cliente: semOptin, status: "atendido", daqui: "-20 days" });
      const semWhats = await novaCliente(c, { whatsapp: null });
      const agSemWhats = await agendar(c, { cliente: semWhats, status: "atendido", daqui: "-21 days" });
      const ok = await novaCliente(c);
      const agOk = await agendar(c, { cliente: ok, status: "atendido", daqui: "-22 days" });
      const agFaltou = await agendar(c, { cliente: ok, status: "faltou", daqui: "-23 days" });
      const agSemDias = await agendar(c, { cliente: ok, servico: servicoSem, status: "atendido", daqui: "-24 days" });

      await logarComo(c, recepcao);
      expect((await falha(c, "select enviar_retorno($1)", [agSemOptin])).message).toBe(MSG_SEM_OPTIN);
      expect((await falha(c, "select enviar_retorno($1)", [agSemWhats])).message).toBe(MSG_SEM_WHATS);
      expect((await falha(c, "select enviar_retorno($1)", [agFaltou])).message).toBe(MSG_SEM_RETORNO);
      expect((await falha(c, "select enviar_retorno($1)", [agSemDias])).message).toBe(MSG_SEM_RETORNO);
      expect((await falha(c, "select enviar_retorno(gen_random_uuid())", [])).message).toBe(
        "Agendamento não encontrado.",
      );
      await c.query("select enviar_retorno($1)", [agOk]);
      expect((await falha(c, "select enviar_retorno($1)", [agOk])).message).toBe(MSG_RETORNO_DUPLICADO);
      await comoSuper(c);
    });
  });

  it("sucesso: 1 pendente para agora com a origem", async () => {
    await emTeste(async (c) => {
      const cli = await novaCliente(c);
      const ag = await agendar(c, { cliente: cli, status: "atendido", daqui: "-40 days" });
      const id = await como(c, recepcao, async () =>
        (await c.query<{ id: string }>("select enviar_retorno($1) as id", [ag])).rows[0].id,
      );
      const m = await msg(c, id);
      const agora = (await c.query<{ n: Date }>("select now() as n")).rows[0].n;
      expect(m).toMatchObject({
        tipo: "retorno",
        status: "pendente",
        cliente_id: cli,
        agendamento_id: ag,
        lead_id: null,
        texto: null,
        criado_por: recepcaoId,
      });
      expect(m.agendado_para.getTime()).toBe(agora.getTime());
      expect(await filaDoTipo(c, "retorno", [cli])).toHaveLength(1);

      // Depois de cancelado, pode enviar de novo.
      await c.query("update fila_mensagens set status = 'cancelada', cancelada_motivo = 'x' where id = $1", [id]);
      await como(c, dona, () => c.query("select enviar_retorno($1)", [ag]));
      expect((await filaDoTipo(c, "retorno", [cli])).map((l) => l.status)).toEqual(["cancelada", "pendente"]);
    });
  });
});

describe("enviar_reativacao", () => {
  it("lote misto: só a ok entra; repetir não duplica", async () => {
    await emTeste(async (c) => {
      const semWhats = await novaCliente(c, { whatsapp: null });
      const semOptin = await novaCliente(c, { marketing: false });
      const recente = await novaCliente(c);
      const r10 = await naFila(c, { tipo: "reativacao", cliente: recente, ha: "10 days" });
      await c.query(
        `update fila_mensagens set criado_em = now() - interval '10 days', status = 'enviada',
           texto = 'x', enviada_em = now() - interval '10 days' where id = $1`,
        [r10],
      );
      const ok = await novaCliente(c);
      // Reativação cancelada não conta para a carência; antiga (40 dias) também não.
      const antiga = await novaCliente(c);
      const r40 = await naFila(c, { tipo: "reativacao", cliente: antiga, ha: "40 days" });
      await c.query("update fila_mensagens set criado_em = now() - interval '40 days' where id = $1", [r40]);
      const cancelada = await novaCliente(c);
      const rc = await naFila(c, { tipo: "reativacao", cliente: cancelada });
      await c.query("update fila_mensagens set status = 'cancelada', cancelada_motivo = 'x' where id = $1", [rc]);

      const lote = [semWhats, semOptin, recente, ok];
      const r1 = await como(c, recepcao, async () =>
        (await c.query("select * from enviar_reativacao($1::uuid[])", [lote])).rows,
      );
      expect(r1).toEqual([{ enfileiradas: 1, puladas: 3 }]);
      const fila = await filaDoTipo(c, "reativacao", [ok]);
      expect(fila).toHaveLength(1);
      expect(fila[0].status).toBe("pendente");

      const r2 = await como(c, recepcao, async () =>
        (await c.query("select * from enviar_reativacao($1::uuid[])", [lote])).rows,
      );
      expect(r2).toEqual([{ enfileiradas: 0, puladas: 4 }]);

      const r3 = await como(c, dona, async () =>
        (await c.query("select * from enviar_reativacao($1::uuid[])", [[antiga, cancelada, cancelada]])).rows,
      );
      expect(r3).toEqual([{ enfileiradas: 2, puladas: 0 }]);
    });
  });

  it("cliente inativa é pulada", async () => {
    await emTeste(async (c) => {
      const inativa = await novaCliente(c, { ativo: false });
      const r = await como(c, recepcao, async () =>
        (await c.query("select * from enviar_reativacao($1::uuid[])", [[inativa]])).rows,
      );
      expect(r).toEqual([{ enfileiradas: 0, puladas: 1 }]);
    });
  });

  it("limites: vazio e mais de 500", async () => {
    await emTeste(async (c) => {
      await logarComo(c, recepcao);
      expect((await falha(c, "select * from enviar_reativacao('{}'::uuid[])", [])).message).toBe(MSG_LOTE_VAZIO);
      expect((await falha(c, "select * from enviar_reativacao(null)", [])).message).toBe(MSG_LOTE_VAZIO);
      const muitos = Array.from({ length: 501 }, () => randomUUID());
      expect((await falha(c, "select * from enviar_reativacao($1::uuid[])", [muitos])).message).toBe(
        MSG_LOTE_GRANDE,
      );
      const r = await c.query("select * from enviar_reativacao($1::uuid[])", [muitos.slice(0, 500)]);
      expect(r.rows).toEqual([{ enfileiradas: 0, puladas: 500 }]);
      await comoSuper(c);
    });
  });
});

describe("enviar_avulsa_lead", () => {
  it("cria a linha com lead_id e sem cliente; erros", async () => {
    await emTeste(async (c) => {
      const whats = zap();
      const lead = (
        await c.query<{ id: string }>("insert into leads (nome, whatsapp) values ('Carla Dias', $1) returning id", [whats])
      ).rows[0].id;
      const semWhats = (
        await c.query<{ id: string }>("insert into leads (nome) values ('Sem Zap') returning id")
      ).rows[0].id;
      const id = await como(c, recepcao, async () => {
        expect((await falha(c, "select enviar_avulsa_lead($1, '   ')", [lead])).message).toBe(MSG_VAZIA);
        expect((await falha(c, "select enviar_avulsa_lead($1, 'Oi')", [semWhats])).message).toBe(
          MSG_LEAD_SEM_WHATS,
        );
        expect((await falha(c, "select enviar_avulsa_lead(gen_random_uuid(), 'Oi')", [])).message).toBe(
          "Lead não encontrado.",
        );
        return (await c.query<{ id: string }>("select enviar_avulsa_lead($1, '  Olá, Carla!  ') as id", [lead]))
          .rows[0].id;
      });
      expect(await msg(c, id)).toMatchObject({
        tipo: "avulsa",
        status: "pendente",
        lead_id: lead,
        cliente_id: null,
        telefone: whats,
        texto: "Olá, Carla!",
        criado_por: recepcaoId,
      });

      // No envio, o nome vem do lead.
      await configurar(c);
      const r = await proxima(c);
      expect(r).toHaveLength(1);
      expect(r[0]).toMatchObject({ id, tipo: "avulsa", nome: "Carla Dias", texto: "Olá, Carla!", telefone: whats });
    });
  });
});

describe("enfileirar_retornos_do_dia", () => {
  it("janela hoje − 2 a hoje, às 09:00 SP; sem duplicar", async () => {
    await emTeste(async (c) => {
      // dias_retorno = 30: atendido em 10-18 → retorno em 11-17, e assim por diante.
      const cli: Record<string, string> = {};
      const ag: Record<string, string> = {};
      for (const [dia, inicio] of [
        ["09-01", "2026-08-02 10:00-03"],
        ["11-17", "2026-10-18 10:00-03"],
        ["11-18", "2026-10-19 10:00-03"],
        ["11-19", "2026-10-20 23:30-03"],
        ["11-20", "2026-10-21 10:00-03"],
        ["11-21", "2026-10-22 10:00-03"],
      ] as const) {
        cli[dia] = await novaCliente(c, { nome: dia });
        ag[dia] = await agendar(c, { cliente: cli[dia], status: "atendido", inicio });
      }
      const todas = Object.values(cli);

      const n = (await c.query<{ n: number }>("select enfileirar_retornos_do_dia('2026-11-20') as n")).rows[0].n;
      expect(n).toBe(3);
      const quando = (
        await c.query<{ q: Date }>("select greatest(timestamptz '2026-11-20 09:00-03', now()) as q")
      ).rows[0].q;
      const fila = await filaDoTipo(c, "retorno", todas);
      expect(fila.map((l) => l.agendamento_id).sort()).toEqual([ag["11-18"], ag["11-19"], ag["11-20"]].sort());
      expect(fila.every((l) => l.status === "pendente" && l.agendado_para.getTime() === quando.getTime())).toBe(true);

      const n2 = (await c.query<{ n: number }>("select enfileirar_retornos_do_dia('2026-11-20') as n")).rows[0].n;
      expect(n2).toBe(0);
      expect(await filaDoTipo(c, "retorno", todas)).toHaveLength(3);
    });
  });

  it("exclusões: sem opt-in, sem WhatsApp, inativa, com agendamento futuro, retorno que falhou", async () => {
    await emTeste(async (c) => {
      const inicio = "2026-10-21 10:00-03"; // retorno em 2026-11-20
      const semOptin = await novaCliente(c, { marketing: false });
      await agendar(c, { cliente: semOptin, status: "atendido", inicio });
      const semWhats = await novaCliente(c, { whatsapp: null });
      await agendar(c, { cliente: semWhats, status: "atendido", inicio: "2026-10-21 11:00-03" });
      const inativa = await novaCliente(c, { ativo: false });
      await agendar(c, { cliente: inativa, status: "atendido", inicio: "2026-10-21 12:00-03" });
      const comFuturo = await novaCliente(c);
      await agendar(c, { cliente: comFuturo, status: "atendido", inicio: "2026-10-21 13:00-03" });
      await agendar(c, { cliente: comFuturo, servico: servicoSem, status: "confirmado", daqui: "4 days" });
      const falhou = await novaCliente(c);
      const agFalhou = await agendar(c, { cliente: falhou, status: "atendido", inicio: "2026-10-21 14:00-03" });
      const f = await naFila(c, { tipo: "retorno", cliente: falhou, agendamento: agFalhou });
      await c.query("update fila_mensagens set status = 'falhou' where id = $1", [f]);
      // Retorno cancelado não impede o automático.
      const cancelada = await novaCliente(c);
      const agCanc = await agendar(c, { cliente: cancelada, status: "atendido", inicio: "2026-10-21 15:00-03" });
      const fc = await naFila(c, { tipo: "retorno", cliente: cancelada, agendamento: agCanc });
      await c.query("update fila_mensagens set status = 'cancelada', cancelada_motivo = 'x' where id = $1", [fc]);

      const n = (await c.query<{ n: number }>("select enfileirar_retornos_do_dia('2026-11-20') as n")).rows[0].n;
      expect(n).toBe(1);
      expect(
        (await filaDoTipo(c, "retorno", [cancelada])).map((l) => l.status),
      ).toEqual(["cancelada", "pendente"]);
    });
  });

  it("enfileirar_retornos usa a data de hoje em SP", async () => {
    await emTeste(async (c) => {
      const cli = await novaCliente(c);
      // Atendido há 30 dias (data SP) → retorno hoje.
      await agendar(c, { cliente: cli, status: "atendido", daqui: "-30 days" });
      const n = (await c.query<{ n: number }>("select enfileirar_retornos() as n")).rows[0].n;
      expect(n).toBe(1);
      expect(await filaDoTipo(c, "retorno", [cli])).toHaveLength(1);
    });
  });
});

describe("proxima_mensagem — retorno e reativação", () => {
  it("cliente agendou depois de entrar na fila → cancela com 'Cliente já agendou'", async () => {
    await emTeste(async (c) => {
      await configurar(c);
      const cli = await novaCliente(c);
      const ag = await agendar(c, { cliente: cli, status: "atendido", daqui: "-30 days" });
      const ret = await naFila(c, { tipo: "retorno", cliente: cli, agendamento: ag });
      const outra = await novaCliente(c);
      const rea = await naFila(c, { tipo: "reativacao", cliente: outra });
      await agendar(c, { cliente: cli, servico: servicoSem, status: "pendente", daqui: "3 days" });
      await agendar(c, { cliente: outra, servico: servicoSem, status: "confirmado", daqui: "5 days" });

      expect(await proxima(c)).toEqual([]);
      for (const id of [ret, rea]) {
        expect(await msg(c, id)).toMatchObject({ status: "cancelada", cancelada_motivo: "Cliente já agendou" });
      }
    });
  });

  it("opt-in retirado → 'Cliente sem opt-in de marketing'", async () => {
    await emTeste(async (c) => {
      await configurar(c);
      const cli = await novaCliente(c);
      const ag = await agendar(c, { cliente: cli, status: "atendido", daqui: "-30 days" });
      const ret = await naFila(c, { tipo: "retorno", cliente: cli, agendamento: ag });
      const rea = await naFila(c, { tipo: "reativacao", cliente: cli });
      await c.query("update clientes set aceita_whatsapp_marketing = false where id = $1", [cli]);

      expect(await proxima(c)).toEqual([]);
      for (const id of [ret, rea]) {
        expect(await msg(c, id)).toMatchObject({
          status: "cancelada",
          cancelada_motivo: "Cliente sem opt-in de marketing",
        });
      }
    });
  });

  it("pendente ainda não vencido não é tocado", async () => {
    await emTeste(async (c) => {
      await configurar(c);
      const cli = await novaCliente(c);
      const rea = await naFila(c, { tipo: "reativacao", cliente: cli, ha: "-2 hours" });
      await c.query("update clientes set aceita_whatsapp_marketing = false where id = $1", [cli]);
      expect(await proxima(c)).toEqual([]);
      expect((await msg(c, rea)).status).toBe("pendente");
    });
  });

  it("retorno válido sai com o serviço e o nome da cliente", async () => {
    await emTeste(async (c) => {
      await configurar(c);
      const cli = await novaCliente(c, { nome: "Maria Silva" });
      const ag = await agendar(c, { cliente: cli, status: "atendido", daqui: "-30 days" });
      const ret = await naFila(c, { tipo: "retorno", cliente: cli, agendamento: ag });
      const r = await proxima(c);
      expect(r).toHaveLength(1);
      expect(r[0]).toMatchObject({
        id: ret,
        tipo: "retorno",
        nome: "Maria Silva",
        servico: "Botox",
        variacoes: [
          "Oi, {nome}! Já está na hora de renovar seu {servico}. Quer que a gente reserve um horário para você? {clinica}",
        ],
      });
      expect((await msg(c, ret)).status).toBe("enviando");
    });
  });

  it("vencidos há mais de 24 h perdem a validade", async () => {
    await emTeste(async (c) => {
      await configurar(c);
      const cli = await novaCliente(c);
      const ag = await agendar(c, { cliente: cli, status: "atendido", daqui: "-30 days" });
      const rea = await naFila(c, { tipo: "reativacao", cliente: cli, ha: "25 hours" });
      const ret = await naFila(c, { tipo: "retorno", cliente: cli, agendamento: ag, ha: "25 hours" });
      expect(await proxima(c)).toEqual([]);
      for (const id of [rea, ret]) {
        expect(await msg(c, id)).toMatchObject({
          status: "cancelada",
          cancelada_motivo: "Mensagem perdeu a validade",
        });
      }
    });
  });
});
