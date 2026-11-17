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

// 0019: notificações em tempo real (notificacoes, gatilhos, RLS,
// marcar_notificacoes_lidas, preferencias_notificacao,
// salvar_preferencias_notificacao, limpar_notificacoes_antigas).

const ZAP = "5511987654321";
const DESCONHECIDO_SEM_9 = "552188887777";
const TODOS_TIPOS = [
  "mensagem_recebida",
  "pedido_online",
  "confirmou",
  "quer_remarcar",
  "pediu_equipe",
  "agenda_profissional",
  "mensagem_falhou",
];

let dona: { uid: string; colaboradorId: string };
let recepcao: { uid: string; colaboradorId: string };
let recepcaoInativa: { uid: string; colaboradorId: string };
let ana: { uid: string; colaboradorId: string };
let bia: { uid: string; colaboradorId: string };
let cli: string;
let servico: string;
let seq = 0;

type Linha = {
  colaborador_id: string;
  tipo: string;
  titulo: string;
  corpo: string | null;
  link: string;
};

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

/** Transação desfeita no fim, começando como superusuário. */
function emTeste<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  return comoUsuario(dona.uid, async (c) => {
    await comoSuper(c);
    return fn(c);
  });
}

async function falha(c: PoolClient, sql: string, params: unknown[], sqlstate = "P0001") {
  await c.query("savepoint tentativa");
  const erro = await esperarErroSql(c.query(sql, params), sqlstate);
  await c.query("rollback to savepoint tentativa");
  return erro;
}

async function notificacoes(c: PoolClient, tipo?: string): Promise<Linha[]> {
  const r = await c.query<Linha>(
    `select colaborador_id, tipo, titulo, corpo, link from notificacoes
     where $1::text is null or tipo = $1 order by criada_em, titulo, colaborador_id`,
    [tipo ?? null],
  );
  return r.rows;
}

const destinatarios = (linhas: Linha[]) => linhas.map((l) => l.colaborador_id).sort();
const ids = (...cs: { colaboradorId: string }[]) => cs.map((x) => x.colaboradorId).sort();

/** Agendamento da Maria com a profissional, em 14/11/2030 15:00 (SP). */
async function agendamento(
  c: PoolClient,
  profissionalId: string,
  status = "pendente",
  inicio = "2030-11-14T15:00:00-03:00",
): Promise<string> {
  return (
    await c.query<{ id: string }>(
      `insert into agendamentos (cliente_id, profissional_id, servico_id, inicio, fim, status)
       values ($1, $2, $3, $4::timestamptz, $4::timestamptz + interval '30 minutes', $5)
       returning id`,
      [cli, profissionalId, servico, inicio, status],
    )
  ).rows[0].id;
}

async function recebida(
  c: PoolClient,
  p: { telefone?: string; texto?: string; cliente?: string | null; agendamento?: string | null; classificacao?: string },
) {
  seq += 1;
  await c.query(
    `insert into mensagens_recebidas (telefone, texto, id_externo, cliente_id, agendamento_id, classificacao)
     values ($1, $2, $3, $4, $5, $6)`,
    [
      p.telefone ?? ZAP,
      p.texto ?? "Oi",
      `ext-${seq}`,
      p.cliente === undefined ? cli : p.cliente,
      p.agendamento ?? null,
      p.classificacao ?? "para_ler",
    ],
  );
}

beforeAll(async () => {
  await resetarBanco();
  dona = await criarUsuario("dona", { nome: "Fernanda" });
  recepcao = await criarUsuario("recepcao", { nome: "Rita" });
  recepcaoInativa = await criarUsuario("recepcao", { nome: "Antiga", ativo: false });
  ana = await criarUsuario("profissional", { nome: "Ana" });
  bia = await criarUsuario("profissional", { nome: "Bia" });

  await comoSuperusuario(async (c) => {
    await c.query("insert into configuracoes_clinica (nome) values ('Madame Fê')");
    cli = (
      await c.query<{ id: string }>(
        `insert into clientes (nome, whatsapp, aceite_lgpd_em)
         values ('Maria Silva', $1, now()) returning id`,
        [ZAP],
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

describe("mensagem recebida", () => {
  it("avisa dona e recepção ativas, com nome, prévia e link da conversa", () =>
    emTeste(async (c) => {
      await recebida(c, { texto: "a".repeat(100) });
      const linhas = await notificacoes(c);
      expect(destinatarios(linhas)).toEqual(ids(dona, recepcao));
      expect(linhas[0]).toMatchObject({
        tipo: "mensagem_recebida",
        titulo: "Nova mensagem de Maria",
        corpo: "a".repeat(80),
        link: `/mensagens?conversa=${cli}`,
      });
    }));

  it("sem cadastro: telefone formatado e chave com o 9", () =>
    emTeste(async (c) => {
      await recebida(c, { telefone: DESCONHECIDO_SEM_9, cliente: null, texto: "Olá" });
      const [l] = await notificacoes(c);
      expect(l.titulo).toBe("Nova mensagem de (21) 8888-7777");
      expect(l.link).toBe("/mensagens?conversa=5521988887777");
    }));

  it("telefone fora do padrão: link genérico", () =>
    emTeste(async (c) => {
      await recebida(c, { telefone: "abc?x", cliente: null });
      const [l] = await notificacoes(c);
      expect(l.link).toBe("/mensagens");
    }));

  it("dígito ou 'menu' com o robô atendendo e sem pausa não notifica", () =>
    emTeste(async (c) => {
      await c.query("update configuracoes_clinica set whatsapp_ativo = true");
      await c.query("update robo_config set ativo = true, quando = 'sempre'");
      for (const texto of ["1", " 2. ", "Menu", "0"]) await recebida(c, { texto });
      expect(await notificacoes(c)).toEqual([]);
      await recebida(c, { texto: "oi" });
      expect(destinatarios(await notificacoes(c))).toEqual(ids(dona, recepcao));
    }));

  it("dígito notifica com o robô desligado ou com a conversa pausada", () =>
    emTeste(async (c) => {
      await c.query("update configuracoes_clinica set whatsapp_ativo = true");
      await c.query("update robo_config set ativo = false");
      await recebida(c, { texto: "1" });
      expect(await notificacoes(c)).toHaveLength(2);

      await c.query("update robo_config set ativo = true, quando = 'sempre'");
      // Pausa gravada com o número sem o 9: robo_telefones cobre as duas formas.
      await c.query(
        "insert into robo_sessoes (telefone, pausado_ate) values ('551187654321', now() + interval '1 hour')",
      );
      await recebida(c, { texto: "2" });
      expect(await notificacoes(c)).toHaveLength(4);
    }));

  it("profissional não recebe mensagens comuns", () =>
    emTeste(async (c) => {
      await recebida(c, {});
      expect(destinatarios(await notificacoes(c))).not.toContain(ana.colaboradorId);
    }));
});

describe("confirmou / quer remarcar", () => {
  it("confirmou: dona, recepção e só a profissional do agendamento", () =>
    emTeste(async (c) => {
      const ag = await agendamento(c, ana.colaboradorId);
      await c.query("delete from notificacoes");
      await recebida(c, { texto: "1", agendamento: ag, classificacao: "confirmou" });
      const linhas = await notificacoes(c);
      expect(destinatarios(linhas)).toEqual(ids(dona, recepcao, ana));
      expect(linhas.every((l) => l.tipo === "confirmou")).toBe(true);
      expect(linhas[0].titulo).toBe("Maria confirmou o horário de 14/11 às 15:00");
      expect(linhas[0].corpo).toBe("Limpeza de pele com Ana");
      expect(linhas.every((l) => l.link === "/agenda?data=2030-11-14")).toBe(true);
      expect(destinatarios(await notificacoes(c, "mensagem_recebida"))).toEqual([]);
    }));

  it("quer remarcar: equipe vai à conversa, profissional à agenda", () =>
    emTeste(async (c) => {
      const ag = await agendamento(c, bia.colaboradorId);
      await c.query("delete from notificacoes");
      await recebida(c, { texto: "2", agendamento: ag, classificacao: "quer_remarcar" });
      const linhas = await notificacoes(c, "quer_remarcar");
      expect(destinatarios(linhas)).toEqual(ids(dona, recepcao, bia));
      expect(linhas[0].titulo).toBe("Maria quer remarcar o horário de 14/11 às 15:00");
      const porId = new Map(linhas.map((l) => [l.colaborador_id, l.link]));
      expect(porId.get(bia.colaboradorId)).toBe("/agenda?data=2030-11-14");
      expect(porId.get(recepcao.colaboradorId)).toBe(`/mensagens?conversa=${cli}`);
    }));

  it("profissional inativa não recebe", () =>
    emTeste(async (c) => {
      const ag = await agendamento(c, bia.colaboradorId);
      await c.query("update colaboradores set ativo = false where id = $1", [bia.colaboradorId]);
      await c.query("delete from notificacoes");
      await recebida(c, { agendamento: ag, classificacao: "confirmou" });
      expect(destinatarios(await notificacoes(c))).toEqual(ids(dona, recepcao));
    }));
});

describe("pedido online", () => {
  it("pedido aguardando avisa dona e recepção", () =>
    emTeste(async (c) => {
      const p = (
        await c.query<{ id: string }>(
          `insert into pedidos_online (servico_id, profissional_id, inicio, fim, nome, whatsapp,
             aceite_privacidade_em)
           values ($1, $2, '2030-11-14T15:00:00-03:00', '2030-11-14T15:30:00-03:00', 'Joana Souza',
             '5521999998888', now()) returning id`,
          [servico, ana.colaboradorId],
        )
      ).rows[0].id;
      const linhas = await notificacoes(c);
      expect(destinatarios(linhas)).toEqual(ids(dona, recepcao));
      expect(linhas[0]).toMatchObject({
        tipo: "pedido_online",
        titulo: "Novo pedido online — Limpeza de pele, 14/11 às 15:00",
        corpo: "Pedido de Joana. Aprove ou recuse na agenda.",
        link: `/agenda/pedidos?pedido=${p}`,
      });
    }));
});

describe("pediu para falar com a equipe", () => {
  it("avisa quando pediu_equipe_em passa a ter valor (e de novo quando muda)", () =>
    emTeste(async (c) => {
      await c.query("insert into robo_sessoes (telefone, cliente_id) values ($1, $2)", [ZAP, cli]);
      expect(await notificacoes(c)).toEqual([]);
      await c.query("update robo_sessoes set pediu_equipe_em = now() where telefone = $1", [ZAP]);
      const linhas = await notificacoes(c);
      expect(destinatarios(linhas)).toEqual(ids(dona, recepcao));
      expect(linhas[0]).toMatchObject({
        tipo: "pediu_equipe",
        titulo: "Maria pediu para falar com a equipe",
        link: `/mensagens?conversa=${cli}`,
      });
      await c.query("update robo_sessoes set menu_enviado_em = now() where telefone = $1", [ZAP]);
      expect(await notificacoes(c)).toHaveLength(2);
      await c.query("update robo_sessoes set pediu_equipe_em = null where telefone = $1", [ZAP]);
      expect(await notificacoes(c)).toHaveLength(2);
    }));

  it("sessão criada já pedindo a equipe também avisa", () =>
    emTeste(async (c) => {
      await c.query(
        "insert into robo_sessoes (telefone, pediu_equipe_em) values ($1, now())",
        [DESCONHECIDO_SEM_9],
      );
      const [l] = await notificacoes(c);
      expect(l.titulo).toBe("(21) 8888-7777 pediu para falar com a equipe");
      expect(l.link).toBe("/mensagens?conversa=5521988887777");
    }));
});

describe("agenda da profissional", () => {
  it("novo agendamento avisa só a profissional dele", () =>
    emTeste(async (c) => {
      await agendamento(c, ana.colaboradorId);
      const linhas = await notificacoes(c, "agenda_profissional");
      expect(destinatarios(linhas)).toEqual(ids(ana));
      expect(linhas[0]).toMatchObject({
        titulo: "Novo agendamento — 14/11 às 15:00",
        corpo: "Maria · Limpeza de pele",
        link: "/agenda?data=2030-11-14",
      });
    }));

  it("cancelamento avisa; outras mudanças não", () =>
    emTeste(async (c) => {
      const ag = await agendamento(c, ana.colaboradorId);
      await c.query("delete from notificacoes");
      await c.query("update agendamentos set status = 'confirmado' where id = $1", [ag]);
      expect(await notificacoes(c)).toEqual([]);
      await c.query("update agendamentos set status = 'cancelado' where id = $1", [ag]);
      const [l, ...resto] = await notificacoes(c);
      expect(resto).toEqual([]);
      expect(l).toMatchObject({
        colaborador_id: ana.colaboradorId,
        titulo: "Agendamento cancelado — 14/11 às 15:00",
      });
      await c.query("update agendamentos set observacoes = 'x' where id = $1", [ag]);
      expect(await notificacoes(c)).toHaveLength(1);
    }));

  it("a própria profissional que agenda não é avisada; inativa também não", () =>
    emTeste(async (c) => {
      // Superusuário com as claims da Ana: colaborador_atual_id() = Ana.
      await c.query("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify({ sub: ana.uid, role: "authenticated" }),
      ]);
      await agendamento(c, ana.colaboradorId);
      expect(await notificacoes(c)).toEqual([]);

      await c.query("select set_config('request.jwt.claims', '', true)");
      await c.query("update colaboradores set ativo = false where id = $1", [bia.colaboradorId]);
      await agendamento(c, bia.colaboradorId, "pendente", "2030-11-15T15:00:00-03:00");
      expect(await notificacoes(c)).toEqual([]);
    }));

  it("agendamento já no passado não avisa", () =>
    emTeste(async (c) => {
      await agendamento(c, ana.colaboradorId, "atendido", "2020-01-10T10:00:00-03:00");
      expect(await notificacoes(c)).toEqual([]);
    }));
});

describe("mensagem com falha", () => {
  it("fila → falhou avisa dona e recepção", () =>
    emTeste(async (c) => {
      const f = (
        await c.query<{ id: string }>(
          `insert into fila_mensagens (tipo, cliente_id, telefone, texto, agendado_para)
           values ('avulsa', $1, $2, 'Oi', now()) returning id`,
          [cli, ZAP],
        )
      ).rows[0].id;
      expect(await notificacoes(c)).toEqual([]);
      await c.query("update fila_mensagens set status = 'falhou', erro = 'x' where id = $1", [f]);
      const linhas = await notificacoes(c);
      expect(destinatarios(linhas)).toEqual(ids(dona, recepcao));
      expect(linhas[0]).toMatchObject({
        tipo: "mensagem_falhou",
        titulo: "Mensagem não enviada para Maria",
        link: `/mensagens?conversa=${cli}`,
      });
      await c.query("update fila_mensagens set erro = 'y' where id = $1", [f]);
      expect(await notificacoes(c)).toHaveLength(2);
    }));
});

describe("gatilhos nunca falham o comando original", () => {
  it("erro ao notificar vira aviso e o insert segue", () =>
    emTeste(async (c) => {
      await c.query(
        "alter table notificacoes add constraint quebrada check (false) not valid",
      );
      await recebida(c, {});
      const ag = await agendamento(c, ana.colaboradorId);
      await c.query("update agendamentos set status = 'cancelado' where id = $1", [ag]);
      expect((await c.query("select 1 from mensagens_recebidas")).rowCount).toBe(1);
      expect(await notificacoes(c)).toEqual([]);
    }));
});

describe("RLS e marcar como lidas", () => {
  async function semear(c: PoolClient) {
    await recebida(c, { texto: "um" });
    await recebida(c, { texto: "dois" });
  }

  it("cada um lê só as próprias; ninguém insere nem apaga direto", () =>
    emTeste(async (c) => {
      await semear(c);
      await agendamento(c, ana.colaboradorId);
      await logarComo(c, recepcao.uid);
      const r = await c.query("select colaborador_id from notificacoes");
      expect(r.rowCount).toBe(2);
      expect(r.rows.every((x) => x.colaborador_id === recepcao.colaboradorId)).toBe(true);
      await logarComo(c, ana.uid);
      expect((await c.query("select 1 from notificacoes")).rowCount).toBe(1);
      await logarComo(c, bia.uid);
      expect((await c.query("select 1 from notificacoes")).rowCount).toBe(0);
      await falha(
        c,
        "insert into notificacoes (colaborador_id, tipo, titulo, link) values ($1, 'pedido_online', 'x', '/')",
        [bia.colaboradorId],
        "42501",
      );
      await falha(c, "delete from notificacoes", [], "42501");
      await falha(c, "update notificacoes set titulo = 'x'", [], "42501");
    }));

  it("update de lida_em só alcança as próprias", () =>
    emTeste(async (c) => {
      await semear(c);
      await logarComo(c, recepcao.uid);
      const r = await c.query("update notificacoes set lida_em = now()");
      expect(r.rowCount).toBe(2);
      await comoSuper(c);
      const lidas = await c.query<{ colaborador_id: string }>(
        "select colaborador_id from notificacoes where lida_em is not null",
      );
      expect(lidas.rows.every((x) => x.colaborador_id === recepcao.colaboradorId)).toBe(true);
    }));

  it("marcar_notificacoes_lidas: ids escolhidos ou todas, só do usuário", () =>
    emTeste(async (c) => {
      await semear(c);
      const daDona = (
        await c.query<{ id: string }>(
          "select id from notificacoes where colaborador_id = $1 order by corpo",
          [dona.colaboradorId],
        )
      ).rows.map((x) => x.id);
      const daRecepcao = (
        await c.query<{ id: string }>("select id from notificacoes where colaborador_id = $1", [
          recepcao.colaboradorId,
        ])
      ).rows.map((x) => x.id);

      await logarComo(c, dona.uid);
      const um = await c.query<{ n: number }>("select marcar_notificacoes_lidas($1) as n", [
        [daDona[0], ...daRecepcao],
      ]);
      expect(um.rows[0].n).toBe(1);
      const todas = await c.query<{ n: number }>("select marcar_notificacoes_lidas() as n");
      expect(todas.rows[0].n).toBe(1);
      expect((await c.query("select marcar_notificacoes_lidas(null) as n")).rows[0].n).toBe(0);

      await comoSuper(c);
      const naoLidas = await c.query(
        "select 1 from notificacoes where colaborador_id = $1 and lida_em is null",
        [recepcao.colaboradorId],
      );
      expect(naoLidas.rowCount).toBe(2);
    }));

  it("anônimo e sem colaborador não usam", () =>
    emTeste(async (c) => {
      await c.query("set local role anon");
      await falha(c, "select 1 from notificacoes", [], "42501");
      await falha(c, "select marcar_notificacoes_lidas()", [], "42501");
      await comoSuper(c);
      await logarComo(c, recepcaoInativa.uid);
      await falha(c, "select marcar_notificacoes_lidas()", []);
    }));
});

describe("preferências", () => {
  it("salva e lê as próprias, com padrões", () =>
    comoUsuario(ana.uid, async (c) => {
      expect((await c.query("select 1 from preferencias_notificacao")).rowCount).toBe(0);
      await c.query("select salvar_preferencias_notificacao(true, 40, true, null)");
      const r = await c.query("select som, volume, desktop, tipos from preferencias_notificacao");
      expect(r.rows[0]).toMatchObject({ som: true, volume: 40, desktop: true, tipos: TODOS_TIPOS });

      await c.query("select salvar_preferencias_notificacao(false, 75, false, $1)", [
        ["confirmou", "agenda_profissional", "confirmou"],
      ]);
      const r2 = await c.query("select som, volume, desktop, tipos from preferencias_notificacao");
      expect(r2.rows[0]).toMatchObject({
        som: false,
        volume: 75,
        desktop: false,
        tipos: ["agenda_profissional", "confirmou"],
      });
      expect((await c.query("select 1 from preferencias_notificacao")).rowCount).toBe(1);
    }));

  it("valida volume e tipos", () =>
    comoUsuario(ana.uid, async (c) => {
      expect(
        await falha(c, "select salvar_preferencias_notificacao(true, 101, true, null)", []),
      ).toMatchObject({ message: "O volume vai de 0 a 100." });
      expect(
        await falha(c, "select salvar_preferencias_notificacao(true, 10, true, $1)", [["xyz"]]),
      ).toMatchObject({ message: "Tipo de notificação inválido." });
      await c.query("select salvar_preferencias_notificacao(true, 0, true, '{}')");
    }));

  it("ninguém lê nem escreve as preferências de outra pessoa", () =>
    emTeste(async (c) => {
      await logarComo(c, ana.uid);
      await c.query("select salvar_preferencias_notificacao(false, 10, false, '{}')");
      await logarComo(c, dona.uid);
      expect((await c.query("select 1 from preferencias_notificacao")).rowCount).toBe(0);
      await falha(
        c,
        "insert into preferencias_notificacao (colaborador_id) values ($1)",
        [dona.colaboradorId],
        "42501",
      );
      await falha(c, "update preferencias_notificacao set som = true", [], "42501");
      await falha(c, "delete from preferencias_notificacao", [], "42501");
    }));
});

describe("funções auxiliares fechadas", () => {
  it("usuários não executam as auxiliares de texto e link", () =>
    comoUsuario(dona.uid, async (c) => {
      for (const sql of [
        "select notificacao_chave_conversa(null, '5511987654321')",
        "select notificacao_link_conversa(null, '5511987654321')",
        "select notificacao_quando(now())",
        "select notificacao_link_agenda(now())",
        "select notificacao_nome(null, '5511987654321')",
      ]) {
        await falha(c, sql, [], "42501");
      }
    }));
});

describe("limpeza", () => {
  it("apaga só as com mais de 30 dias; função fechada para os usuários", () =>
    emTeste(async (c) => {
      await recebida(c, {});
      await c.query(
        "update notificacoes set criada_em = now() - interval '31 days' where colaborador_id = $1",
        [dona.colaboradorId],
      );
      const r = await c.query<{ n: number }>("select limpar_notificacoes_antigas() as n");
      expect(r.rows[0].n).toBe(1);
      expect(destinatarios(await notificacoes(c))).toEqual(ids(recepcao));
      await logarComo(c, dona.uid);
      await falha(c, "select limpar_notificacoes_antigas()", [], "42501");
    }));
});
