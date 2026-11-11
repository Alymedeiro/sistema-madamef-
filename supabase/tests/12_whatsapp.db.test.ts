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

// 0012 (seções 1–2): whatsapp_ativo, modelos_mensagem, fila_mensagens,
// gatilho da agenda, resposta de pedido online, avulsa, cancelar, reenviar e
// aniversários.

const MSG_EQUIPE = "Apenas a dona ou a recepção podem enviar mensagens.";
const MSG_SEM_WHATS = "Esta cliente não tem WhatsApp cadastrado.";
const MSG_VAZIA = "Escreva a mensagem.";
const MSG_REENVIAR = "Só é possível reenviar mensagens com falha ou canceladas.";
const MSG_ENVIADA = "Esta mensagem já foi enviada.";

let dona: string;
let recepcao: string;
let prof: string;
let profId: string;
let cli: string;
let cliSemWhats: string;
let servico: string;

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

/** Transação desfeita ao final, como superusuário. */
function emTeste<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  return comoUsuario(dona, async (c) => {
    await comoSuper(c);
    return fn(c);
  });
}

/** Superusuário: agendamento com início em `inicio` ou `daqui` (intervalo SQL) a partir de agora. */
async function agendar(
  c: PoolClient,
  p: { daqui?: string; inicio?: string; status?: string; cliente?: string } = {},
): Promise<string> {
  const inicio =
    p.inicio ??
    (
      await c.query<{ t: string }>("select (now() + $1::interval)::text as t", [
        p.daqui ?? "48 hours",
      ])
    ).rows[0].t;
  const r = await c.query<{ id: string }>(
    `insert into agendamentos (cliente_id, profissional_id, servico_id, inicio, fim, status)
     values ($1, $2, $3, $4::timestamptz, $4::timestamptz + interval '30 minutes', $5)
     returning id`,
    [p.cliente ?? cli, profId, servico, inicio, p.status ?? "pendente"],
  );
  return r.rows[0].id;
}

type Linha = {
  id: string;
  tipo: string;
  status: string;
  agendado_para: Date;
  cancelada_motivo: string | null;
  telefone: string;
};

async function filaDe(c: PoolClient, ag: string): Promise<Linha[]> {
  return (
    await c.query<Linha>(
      `select id, tipo::text, status::text, agendado_para, cancelada_motivo, telefone
       from fila_mensagens where agendamento_id = $1 order by criado_em, tipo`,
      [ag],
    )
  ).rows;
}

async function inicioDe(c: PoolClient, ag: string): Promise<Date> {
  return (await c.query<{ inicio: Date }>("select inicio from agendamentos where id = $1", [ag]))
    .rows[0].inicio;
}

async function agora(c: PoolClient): Promise<Date> {
  return (await c.query<{ n: Date }>("select now() as n")).rows[0].n;
}

const HORA = 3600_000;

beforeAll(async () => {
  await resetarBanco();
  ({ uid: dona } = await criarUsuario("dona"));
  ({ uid: recepcao } = await criarUsuario("recepcao"));
  ({ uid: prof, colaboradorId: profId } = await criarUsuario("profissional", { nome: "Ana" }));

  await comoSuperusuario(async (c) => {
    await c.query("insert into configuracoes_clinica (nome) values ('Madame Fé')");
    cli = (
      await c.query<{ id: string }>(
        `insert into clientes (nome, whatsapp, aceite_lgpd_em)
         values ('Maria Silva', '5511987654321', now()) returning id`,
      )
    ).rows[0].id;
    cliSemWhats = (
      await c.query<{ id: string }>(
        "insert into clientes (nome, aceite_lgpd_em) values ('Sem Zap', now()) returning id",
      )
    ).rows[0].id;
    const cat = await c.query<{ id: string }>(
      "insert into categorias_servico (nome) values ('Facial') returning id",
    );
    servico = (
      await c.query<{ id: string }>(
        `insert into servicos (nome, categoria_id, duracao_min, preco_centavos)
         values ('Limpeza de pele', $1, 30, 20000) returning id`,
        [cat.rows[0].id],
      )
    ).rows[0].id;
  });
});

afterAll(fecharConexoes);

describe("estrutura", () => {
  it("whatsapp_ativo falso por padrão, enums e permissões das funções", async () => {
    const r = await comoSuperusuario(async (c) => {
      const cfg = await c.query("select whatsapp_ativo from configuracoes_clinica");
      const t = await c.query("select enum_range(null::tipo_mensagem)::text[] as v");
      const s = await c.query("select enum_range(null::status_mensagem)::text[] as v");
      const f = await c.query(
        `select p.proname, has_function_privilege('authenticated', p.oid, 'execute') as auth,
                has_function_privilege('anon', p.oid, 'execute') as anon,
                has_function_privilege('service_role', p.oid, 'execute') as service,
                p.prosecdef as definer
         from pg_proc p
         where p.pronamespace = 'public'::regnamespace
           and p.proname in ('agendamentos_whatsapp', 'pedidos_online_whatsapp',
                             'enviar_avulsa', 'cancelar_mensagem', 'reenviar_mensagem',
                             'enfileirar_aniversarios', 'enfileirar_aniversarios_do_dia',
                             'cancelar_mensagens_agenda', 'enfileirar_mensagem_agenda',
                             'exigir_equipe_whatsapp')
         order by p.proname`,
      );
      return { cfg: cfg.rows[0].whatsapp_ativo, t: t.rows[0].v, s: s.rows[0].v, f: f.rows };
    });
    expect(r.cfg).toBe(false);
    expect(r.t).toEqual([
      "confirmacao",
      "lembrete",
      "pos_atendimento",
      "aniversario",
      "pedido_aprovado",
      "pedido_recusado",
      "avulsa",
    ]);
    expect(r.s).toEqual(["pendente", "enviando", "enviada", "falhou", "cancelada"]);
    const priv = (auth: boolean) => ({ auth, anon: false, definer: true });
    expect(r.f).toEqual([
      { proname: "agendamentos_whatsapp", ...priv(false), service: true },
      { proname: "cancelar_mensagem", ...priv(true), service: true },
      { proname: "cancelar_mensagens_agenda", ...priv(false), service: false },
      { proname: "enfileirar_aniversarios", ...priv(false), service: false },
      { proname: "enfileirar_aniversarios_do_dia", ...priv(false), service: false },
      { proname: "enfileirar_mensagem_agenda", ...priv(false), service: false },
      { proname: "enviar_avulsa", ...priv(true), service: true },
      { proname: "exigir_equipe_whatsapp", ...priv(false), service: false },
      { proname: "pedidos_online_whatsapp", ...priv(false), service: true },
      { proname: "reenviar_mensagem", ...priv(true), service: true },
    ]);
  });

  it("seis modelos padrão (sem avulsa), uma variação cada", async () => {
    const r = await comoUsuario(prof, async (c) =>
      (
        await c.query<{ tipo: string; n: number; ativo: boolean; v: string }>(
          `select m.tipo::text, cardinality(m.variacoes) as n, m.ativo, m.variacoes[1] as v
           from modelos_mensagem m order by m.tipo`,
        )
      ).rows,
    );
    expect(r.map((m) => m.tipo)).toEqual([
      "confirmacao",
      "lembrete",
      "pos_atendimento",
      "aniversario",
      "pedido_aprovado",
      "pedido_recusado",
    ]);
    expect(r.every((m) => m.n === 1 && m.ativo)).toBe(true);
    expect(r[0].v).toBe(
      "Oi, {nome}! Passando para confirmar seu horário de {servico} com {profissional} em {data} às {hora}. Responda 1 para confirmar ou 2 para remarcar. {clinica}",
    );
    expect(r[3].v).toBe(
      "Feliz aniversário, {nome}! 🎉 Toda a equipe da {clinica} deseja um dia lindo para você.",
    );
  });
});

describe("modelos_mensagem", () => {
  it("dona atualiza; recepção não; sem insert/delete", async () => {
    await comoUsuario(dona, async (c) => {
      const r = await c.query(
        "update modelos_mensagem set variacoes = array['Oi {nome}', 'Olá {nome}'] where tipo = 'lembrete'",
      );
      expect(r.rowCount).toBe(1);
      await falha(
        c,
        "insert into modelos_mensagem (tipo, variacoes) values ('avulsa', array['x'])",
        [],
        "42501",
      );
      await falha(c, "delete from modelos_mensagem where tipo = 'lembrete'", [], "42501");
      await falha(c, "update modelos_mensagem set tipo = 'confirmacao' where tipo = 'lembrete'", [], "42501");
    });
    await comoUsuario(recepcao, async (c) => {
      const r = await c.query("update modelos_mensagem set ativo = false where tipo = 'lembrete'");
      expect(r.rowCount).toBe(0);
      expect(await contar(c, "modelos_mensagem")).toBe(6);
    });
  });

  it("variações vazias, 6 itens, só espaços ou > 1000 → 23514", async () => {
    await comoUsuario(dona, async (c) => {
      const upd = "update modelos_mensagem set variacoes = $1 where tipo = 'lembrete'";
      await falha(c, upd, [[]], "23514");
      await falha(c, upd, [["a", "b", "c", "d", "e", "f"]], "23514");
      await falha(c, upd, [["ok", "   "]], "23514");
      await falha(c, upd, [["x".repeat(1001)]], "23514");
      await falha(c, upd, [["ok", null]], "23514");
      const r = await c.query(upd, [["a", "b", "c", "d", "e"]]);
      expect(r.rowCount).toBe(1);
    });
  });

  it("anon não lê", async () => {
    await comoUsuario(null, async (c) => {
      await esperarErroSql(c.query("select * from modelos_mensagem"), "42501");
    });
  });
});

describe("gatilho da agenda", () => {
  it("pendente a 48h → confirmação em inicio−24h e lembrete em inicio−2h", async () => {
    await emTeste(async (c) => {
      const ag = await agendar(c, { daqui: "48 hours" });
      const ini = (await inicioDe(c, ag)).getTime();
      const f = await filaDe(c, ag);
      expect(f.map((m) => [m.tipo, m.status])).toEqual([
        ["confirmacao", "pendente"],
        ["lembrete", "pendente"],
      ]);
      expect(f[0].agendado_para.getTime()).toBe(ini - 24 * HORA);
      expect(f[1].agendado_para.getTime()).toBe(ini - 2 * HORA);
      expect(f[0].telefone).toBe("5511987654321");
    });
  });

  it("pendente a 3h → confirmação agora e lembrete em inicio−2h", async () => {
    await emTeste(async (c) => {
      const ag = await agendar(c, { daqui: "3 hours" });
      const ini = (await inicioDe(c, ag)).getTime();
      const f = await filaDe(c, ag);
      expect(f.map((m) => m.tipo)).toEqual(["confirmacao", "lembrete"]);
      expect(f[0].agendado_para.getTime()).toBe((await agora(c)).getTime());
      expect(f[1].agendado_para.getTime()).toBe(ini - 2 * HORA);
    });
  });

  it("pendente a 1h → confirmação e nenhum lembrete", async () => {
    await emTeste(async (c) => {
      const ag = await agendar(c, { daqui: "1 hour" });
      const f = await filaDe(c, ag);
      expect(f.map((m) => m.tipo)).toEqual(["confirmacao"]);
    });
  });

  it("confirmado a 48h → só lembrete; agendamento passado → nada", async () => {
    await emTeste(async (c) => {
      const ag = await agendar(c, { daqui: "48 hours", status: "confirmado" });
      expect((await filaDe(c, ag)).map((m) => m.tipo)).toEqual(["lembrete"]);
      const passado = await agendar(c, { daqui: "-30 days" });
      expect(await filaDe(c, passado)).toEqual([]);
    });
  });

  it("remarcar 3 vezes → exatamente 1 confirmação e 1 lembrete pendentes, horários novos", async () => {
    await emTeste(async (c) => {
      const ag = await agendar(c, { daqui: "72 hours" });
      for (const h of [1, 2, 3]) {
        await c.query(
          `update agendamentos set inicio = inicio + make_interval(hours => $2),
             fim = fim + make_interval(hours => $2) where id = $1`,
          [ag, h],
        );
      }
      const ini = (await inicioDe(c, ag)).getTime();
      const f = await filaDe(c, ag);
      const pend = f.filter((m) => m.status === "pendente");
      expect(pend.map((m) => m.tipo).sort()).toEqual(["confirmacao", "lembrete"]);
      expect(pend.find((m) => m.tipo === "confirmacao")!.agendado_para.getTime()).toBe(
        ini - 24 * HORA,
      );
      expect(pend.find((m) => m.tipo === "lembrete")!.agendado_para.getTime()).toBe(
        ini - 2 * HORA,
      );
      const canc = f.filter((m) => m.status === "cancelada");
      expect(canc).toHaveLength(6);
      expect(canc.every((m) => m.cancelada_motivo === "Agendamento alterado")).toBe(true);
    });
  });

  it("mudar só o fim ou confirmar não duplica nem cancela", async () => {
    await emTeste(async (c) => {
      const ag = await agendar(c, { daqui: "48 hours" });
      await c.query("update agendamentos set fim = fim + interval '15 minutes' where id = $1", [ag]);
      await c.query("update agendamentos set status = 'confirmado' where id = $1", [ag]);
      const f = await filaDe(c, ag);
      expect(f.map((m) => [m.tipo, m.status])).toEqual([
        ["confirmacao", "pendente"],
        ["lembrete", "pendente"],
      ]);
    });
  });

  it("cancelar → pendentes canceladas com 'Agendamento cancelado'", async () => {
    await emTeste(async (c) => {
      const ag = await agendar(c, { daqui: "48 hours" });
      await c.query("update agendamentos set status = 'cancelado' where id = $1", [ag]);
      const f = await filaDe(c, ag);
      expect(f.map((m) => [m.tipo, m.status, m.cancelada_motivo])).toEqual([
        ["confirmacao", "cancelada", "Agendamento cancelado"],
        ["lembrete", "cancelada", "Agendamento cancelado"],
      ]);
    });
  });

  it("marcar atendido (30/11 15:00 SP) → pós-atendimento 01/12 10:00 SP", async () => {
    await emTeste(async (c) => {
      const ag = await agendar(c, { inicio: "2026-11-30 15:00:00-03", status: "confirmado" });
      await c.query("update agendamentos set status = 'atendido' where id = $1", [ag]);
      const f = await filaDe(c, ag);
      const pos = f.filter((m) => m.tipo === "pos_atendimento");
      expect(pos).toHaveLength(1);
      expect(pos[0].status).toBe("pendente");
      expect(pos[0].agendado_para.toISOString()).toBe("2026-12-01T13:00:00.000Z");
      // Lembrete pendente cancelado ao sair de confirmado.
      expect(f.find((m) => m.tipo === "lembrete")).toMatchObject({
        status: "cancelada",
        cancelada_motivo: "Agendamento alterado",
      });
      // Desmarcar e remarcar atendido não duplica o pós pendente.
      await c.query("update agendamentos set status = 'confirmado' where id = $1", [ag]);
      await c.query("update agendamentos set status = 'atendido' where id = $1", [ag]);
      expect((await filaDe(c, ag)).filter((m) => m.tipo === "pos_atendimento")).toHaveLength(1);
    });
  });

  it("cliente sem WhatsApp → nada", async () => {
    await emTeste(async (c) => {
      const ag = await agendar(c, { daqui: "48 hours", cliente: cliSemWhats });
      await c.query("update agendamentos set status = 'atendido' where id = $1", [ag]);
      expect(await filaDe(c, ag)).toEqual([]);
    });
  });

  it("erro na fila não faz falhar o agendamento", async () => {
    await emTeste(async (c) => {
      // Sabota a fila: qualquer insert viola o check.
      await c.query(
        "alter table fila_mensagens add constraint sabotagem check (tipo = 'avulsa') not valid",
      );
      const ag = await agendar(c, { daqui: "48 hours" });
      await c.query("update agendamentos set status = 'cancelado' where id = $1", [ag]);
      const s = await c.query("select status::text from agendamentos where id = $1", [ag]);
      expect(s.rows[0].status).toBe("cancelado");
      expect(await filaDe(c, ag)).toEqual([]);
    });
  });
});

describe("envio avulso, cancelar e reenviar", () => {
  it("recepção envia; sem WhatsApp e texto vazio → mensagens", async () => {
    await comoUsuario(recepcao, async (c) => {
      const id = (
        await c.query<{ id: string }>("select enviar_avulsa($1, $2) as id", [cli, "  Olá!  "])
      ).rows[0].id;
      const r = await c.query(
        "select tipo::text, status::text, texto, telefone, agendado_para <= now() as agora from fila_mensagens where id = $1",
        [id],
      );
      expect(r.rows[0]).toEqual({
        tipo: "avulsa",
        status: "pendente",
        texto: "Olá!",
        telefone: "5511987654321",
        agora: true,
      });
      expect(
        (await falha(c, "select enviar_avulsa($1, $2)", [cliSemWhats, "Olá"])).message,
      ).toBe(MSG_SEM_WHATS);
      expect((await falha(c, "select enviar_avulsa($1, $2)", [cli, "   "])).message).toBe(
        MSG_VAZIA,
      );
      expect((await falha(c, "select enviar_avulsa($1, null)", [cli])).message).toBe(MSG_VAZIA);
    });
  });

  it("avulsa ligada a um agendamento da cliente", async () => {
    await emTeste(async (c) => {
      const ag = await agendar(c, { daqui: "48 hours", status: "confirmado" });
      await logarComo(c, dona);
      const id = (
        await c.query<{ id: string }>("select enviar_avulsa($1, 'Oi', $2) as id", [cli, ag])
      ).rows[0].id;
      const r = await c.query("select agendamento_id from fila_mensagens where id = $1", [id]);
      expect(r.rows[0].agendamento_id).toBe(ag);
    });
  });

  it("profissional e anon não enviam", async () => {
    await comoUsuario(prof, async (c) => {
      expect((await falha(c, "select enviar_avulsa($1, 'Oi')", [cli])).message).toBe(MSG_EQUIPE);
      expect((await falha(c, "select cancelar_mensagem(gen_random_uuid(), 'x')", [])).message).toBe(
        MSG_EQUIPE,
      );
      expect((await falha(c, "select reenviar_mensagem(gen_random_uuid())", [])).message).toBe(
        MSG_EQUIPE,
      );
    });
    await comoUsuario(null, async (c) => {
      await esperarErroSql(c.query("select enviar_avulsa($1, 'Oi')", [cli]), "42501");
    });
  });

  it("cancelar pendente; enviada → mensagem; reenviar pendente → mensagem; reenviar cancelada → nova", async () => {
    await emTeste(async (c) => {
      await logarComo(c, recepcao);
      const id = (
        await c.query<{ id: string }>("select enviar_avulsa($1, 'Oi') as id", [cli])
      ).rows[0].id;
      expect((await falha(c, "select reenviar_mensagem($1)", [id])).message).toBe(MSG_REENVIAR);
      await c.query("select cancelar_mensagem($1, '  ')", [id]);
      let r = await c.query("select status::text, cancelada_motivo from fila_mensagens where id = $1", [
        id,
      ]);
      expect(r.rows[0]).toEqual({ status: "cancelada", cancelada_motivo: "Cancelada pela equipe" });

      const novo = (await c.query<{ id: string }>("select reenviar_mensagem($1) as id", [id])).rows[0]
        .id;
      r = await c.query("select tipo::text, status::text, texto from fila_mensagens where id = $1", [
        novo,
      ]);
      expect(r.rows[0]).toEqual({ tipo: "avulsa", status: "pendente", texto: "Oi" });

      await comoSuper(c);
      await c.query(
        "update fila_mensagens set status = 'enviada', enviada_em = now() where id = $1",
        [novo],
      );
      await logarComo(c, recepcao);
      expect((await falha(c, "select cancelar_mensagem($1, 'x')", [novo])).message).toBe(
        MSG_ENVIADA,
      );
      expect((await falha(c, "select reenviar_mensagem($1)", [novo])).message).toBe(MSG_REENVIAR);
    });
  });

  it("reenviar confirmação que falhou → nova pendente sem texto", async () => {
    await emTeste(async (c) => {
      const ag = await agendar(c, { daqui: "48 hours" });
      const conf = (await filaDe(c, ag)).find((m) => m.tipo === "confirmacao")!;
      await c.query(
        "update fila_mensagens set status = 'falhou', tentativas = 3, erro = 'x' where id = $1",
        [conf.id],
      );
      await logarComo(c, dona);
      const novo = (await c.query<{ id: string }>("select reenviar_mensagem($1) as id", [conf.id]))
        .rows[0].id;
      const r = await c.query(
        "select tipo::text, status::text, texto, tentativas, agendamento_id from fila_mensagens where id = $1",
        [novo],
      );
      expect(r.rows[0]).toEqual({
        tipo: "confirmacao",
        status: "pendente",
        texto: null,
        tentativas: 0,
        agendamento_id: ag,
      });
    });
  });
});

describe("restrições da fila", () => {
  it("telefone inválido, avulsa sem texto, enviada sem texto, cancelada sem motivo → 23514", async () => {
    await emTeste(async (c) => {
      const ins = `insert into fila_mensagens (tipo, cliente_id, telefone, texto, agendado_para, status, cancelada_motivo)
                   values ($1, $2, $3, $4, now(), $5, $6)`;
      await falha(c, ins, ["avulsa", cli, "11987654321", "x", "pendente", null], "23514");
      await falha(c, ins, ["avulsa", cli, "5511987654321", null, "pendente", null], "23514");
      await falha(c, ins, ["lembrete", cli, "5511987654321", null, "enviada", null], "23514");
      await falha(c, ins, ["lembrete", cli, "5511987654321", null, "cancelada", null], "23514");
      await falha(c, ins, ["lembrete", cli, "5511987654321", null, "pendente", "x"], "23514");
    });
  });
});

describe("RLS da fila", () => {
  it("dona e recepção leem; profissional lê 0 linhas; anon nada; ninguém escreve direto", async () => {
    await comoSuperusuario(async (c) => {
      await c.query(
        `insert into fila_mensagens (tipo, cliente_id, telefone, texto, agendado_para)
         values ('avulsa', $1, '5511987654321', 'RLS', now())`,
        [cli],
      );
    });
    for (const uid of [dona, recepcao]) {
      await comoUsuario(uid, async (c) => {
        expect(await contar(c, "fila_mensagens")).toBeGreaterThan(0);
        await falha(c, "update fila_mensagens set texto = 'x'", [], "42501");
        await falha(
          c,
          `insert into fila_mensagens (tipo, telefone, texto, agendado_para)
           values ('avulsa', '5511987654321', 'x', now())`,
          [],
          "42501",
        );
        await falha(c, "delete from fila_mensagens", [], "42501");
      });
    }
    await comoUsuario(prof, async (c) => {
      expect(await contar(c, "fila_mensagens")).toBe(0);
    });
    await comoUsuario(null, async (c) => {
      await esperarErroSql(c.query("select * from fila_mensagens"), "42501");
    });
    const priv = await comoSuperusuario(async (c) =>
      (
        await c.query(
          `select has_table_privilege('service_role', 'fila_mensagens', 'delete') as d,
                  has_table_privilege('service_role', 'fila_mensagens', 'truncate') as t`,
        )
      ).rows[0],
    );
    expect(priv).toEqual({ d: false, t: false });
  });
});

describe("pedido online", () => {
  async function criarPedido(c: PoolClient, inicio: string, whatsapp = "5521999998888") {
    return (
      await c.query<{ id: string }>(
        `insert into pedidos_online (servico_id, profissional_id, inicio, fim, nome, whatsapp,
           aceite_privacidade_em)
         values ($1, $2, $3::timestamptz, $3::timestamptz + interval '30 minutes', 'Joana', $4, now())
         returning id`,
        [servico, profId, inicio, whatsapp],
      )
    ).rows[0].id;
  }

  async function filaDoPedido(c: PoolClient, pedido: string) {
    return (
      await c.query(
        `select tipo::text, status::text, telefone, cliente_id, agendamento_id,
                agendado_para <= now() as agora
         from fila_mensagens where pedido_online_id = $1`,
        [pedido],
      )
    ).rows;
  }

  it("aprovar → pedido_aprovado pendente para o telefone do pedido", async () => {
    await emTeste(async (c) => {
      await c.query("update configuracoes_clinica set whatsapp_ativo = true");
      const pedido = await criarPedido(c, "2026-12-10 10:00:00-03");
      await logarComo(c, recepcao);
      const ag = (
        await c.query<{ id: string }>(
          `select aprovar_pedido_online($1, $2, $3, '2026-12-10 10:00:00-03',
             '2026-12-10 10:30:00-03', 20000) as id`,
          [pedido, cli, profId],
        )
      ).rows[0].id;
      await comoSuper(c);
      expect(await filaDoPedido(c, pedido)).toEqual([
        {
          tipo: "pedido_aprovado",
          status: "pendente",
          telefone: "5521999998888",
          cliente_id: cli,
          agendamento_id: ag,
          agora: true,
        },
      ]);
      // O agendamento confirmado criado ganha o lembrete (da cliente).
      expect((await filaDe(c, ag)).map((m) => m.tipo).sort()).toEqual([
        "lembrete",
        "pedido_aprovado",
      ]);
    });
  });

  it("recusar → pedido_recusado; WhatsApp do pedido fora do padrão → nada", async () => {
    await emTeste(async (c) => {
      await c.query("update configuracoes_clinica set whatsapp_ativo = true");
      const pedido = await criarPedido(c, "2026-12-11 10:00:00-03");
      const estrangeiro = await criarPedido(c, "2026-12-11 11:00:00-03", "351912345678");
      await logarComo(c, dona);
      await c.query("select recusar_pedido_online($1, 'Sem horário')", [pedido]);
      await c.query("select recusar_pedido_online($1, null)", [estrangeiro]);
      await comoSuper(c);
      expect(await filaDoPedido(c, pedido)).toEqual([
        {
          tipo: "pedido_recusado",
          status: "pendente",
          telefone: "5521999998888",
          cliente_id: null,
          agendamento_id: null,
          agora: true,
        },
      ]);
      expect(await filaDoPedido(c, estrangeiro)).toEqual([]);
      const st = await c.query("select status::text from pedidos_online where id = $1", [
        estrangeiro,
      ]);
      expect(st.rows[0].status).toBe("recusado");
    });
  });

  it("envio desligado → aprovar e recusar não enfileiram (o caminho é o botão manual)", async () => {
    await emTeste(async (c) => {
      await c.query("update configuracoes_clinica set whatsapp_ativo = false");
      const aprovado = await criarPedido(c, "2026-12-12 10:00:00-03");
      const recusado = await criarPedido(c, "2026-12-12 11:00:00-03");
      await logarComo(c, recepcao);
      const ag = (
        await c.query<{ id: string }>(
          `select aprovar_pedido_online($1, $2, $3, '2026-12-12 10:00:00-03',
             '2026-12-12 10:30:00-03', 20000) as id`,
          [aprovado, cli, profId],
        )
      ).rows[0].id;
      await c.query("select recusar_pedido_online($1, null)", [recusado]);
      await comoSuper(c);
      expect(await filaDoPedido(c, aprovado)).toEqual([]);
      expect(await filaDoPedido(c, recusado)).toEqual([]);
      // As mensagens da agenda continuam (o lembrete do agendamento criado).
      expect((await filaDe(c, ag)).map((m) => m.tipo)).toEqual(["lembrete"]);
    });
  });
});

describe("aniversários", () => {
  async function criarCliente(
    c: PoolClient,
    p: { nascimento: string; optin: boolean; whatsapp?: string | null; ativo?: boolean },
  ) {
    return (
      await c.query<{ id: string }>(
        `insert into clientes (nome, whatsapp, data_nascimento, aceita_whatsapp_marketing, ativo,
           aceite_lgpd_em)
         values ('Aniversariante', $1, $2::date, $3, $4, now()) returning id`,
        [p.whatsapp === undefined ? "5511912345678" : p.whatsapp, p.nascimento, p.optin, p.ativo ?? true],
      )
    ).rows[0].id;
  }

  async function aniversariosDe(c: PoolClient, cliente: string) {
    return (
      await c.query<{ agendado_para: Date; status: string }>(
        "select agendado_para, status::text from fila_mensagens where cliente_id = $1 and tipo = 'aniversario'",
        [cliente],
      )
    ).rows;
  }

  it("hoje: só opt-in, ativa e com WhatsApp; segunda chamada não duplica", async () => {
    await emTeste(async (c) => {
      const hoje = (
        await c.query<{ d: string }>(
          "select to_char((now() at time zone 'America/Sao_Paulo')::date, 'MM-DD') as d",
        )
      ).rows[0].d;
      // 29/02 é tratado no outro teste; aqui usa um ano bissexto como nascimento.
      const nasc = `1992-${hoje}`;
      const sim = await criarCliente(c, { nascimento: nasc, optin: true });
      const nao = await criarCliente(c, { nascimento: nasc, optin: false });
      const semZap = await criarCliente(c, { nascimento: nasc, optin: true, whatsapp: null });
      const inativa = await criarCliente(c, { nascimento: nasc, optin: true, ativo: false });

      const n1 = (await c.query<{ n: number }>("select enfileirar_aniversarios() as n")).rows[0].n;
      expect(n1).toBe(1);
      const a = await aniversariosDe(c, sim);
      expect(a).toHaveLength(1);
      const esperado = (
        await c.query<{ t: Date }>(
          `select greatest(((now() at time zone 'America/Sao_Paulo')::date + time '09:00')
             at time zone 'America/Sao_Paulo', now()) as t`,
        )
      ).rows[0].t;
      expect(a[0].agendado_para.getTime()).toBe(esperado.getTime());
      for (const id of [nao, semZap, inativa]) {
        expect(await aniversariosDe(c, id)).toEqual([]);
      }

      const n2 = (await c.query<{ n: number }>("select enfileirar_aniversarios() as n")).rows[0].n;
      expect(n2).toBe(0);
      expect(await aniversariosDe(c, sim)).toHaveLength(1);
    });
  });

  it("29/02 em 2027 → 28/02 09:00 SP; em 2028 só no dia 29; falhou não é recriado", async () => {
    await emTeste(async (c) => {
      const bissexta = await criarCliente(c, { nascimento: "2000-02-29", optin: true });
      const dia = (d: string) =>
        c.query<{ n: number }>("select enfileirar_aniversarios_do_dia($1::date) as n", [d]);

      expect((await dia("2027-02-28")).rows[0].n).toBe(1);
      let a = await aniversariosDe(c, bissexta);
      expect(a.map((m) => m.agendado_para.toISOString())).toEqual(["2027-02-28T12:00:00.000Z"]);

      expect((await dia("2028-02-28")).rows[0].n).toBe(0);
      expect((await dia("2028-02-29")).rows[0].n).toBe(1);

      // Aniversário de 2028 falhou: o job não recria; reenviar cria a nova.
      await c.query(
        `update fila_mensagens set status = 'falhou', tentativas = 3
         where cliente_id = $1 and agendado_para >= '2028-01-01'`,
        [bissexta],
      );
      expect((await dia("2028-02-29")).rows[0].n).toBe(0);
      const falhou = (
        await c.query<{ id: string }>(
          "select id from fila_mensagens where cliente_id = $1 and status = 'falhou'",
          [bissexta],
        )
      ).rows[0].id;
      await logarComo(c, dona);
      await c.query("select reenviar_mensagem($1)", [falhou]);
      await comoSuper(c);
      a = await aniversariosDe(c, bissexta);
      expect(a.map((m) => m.status).sort()).toEqual(["falhou", "pendente", "pendente"]);
    });
  });
});
