import pg from "pg";
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

// 0012 (seções 3–4): envio da fila (proxima_mensagem, concluir/falhar/
// descartar), respostas (mensagens_recebidas, registrar_recebida,
// marcar_recebida_lida), relógio (whatsapp_relogio, disparar_relogio_whatsapp),
// status da conexão e o limite de 1 dia do pós-atendimento (Ruling P3B-R3).

const MSG_EQUIPE = "Apenas a dona ou a recepção podem enviar mensagens.";

const URL_TESTE =
  process.env.DATABASE_URL_TEST ??
  "postgres://postgres:postgres@127.0.0.1:5432/madame_test";

let dona: string;
let recepcao: string;
let prof: string;
let profId: string;
let cli: string;
let cli2: string;
let servico: string;

const ZAP = "5511987654321";
const ZAP2 = "5511912345678";

async function comoSuper(c: PoolClient) {
  await c.query("reset role");
  await c.query("select set_config('request.jwt.claims', '', true)");
}

async function comoServico(c: PoolClient) {
  await c.query("set local role service_role");
  await c.query("select set_config('request.jwt.claims', $1, true)", [
    JSON.stringify({ role: "service_role" }),
  ]);
}

async function logarComo(c: PoolClient, uid: string) {
  await c.query("set local role authenticated");
  await c.query("select set_config('request.jwt.claims', $1, true)", [
    JSON.stringify({ sub: uid, role: "authenticated" }),
  ]);
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

/** Liga o envio com janela que cobre o dia todo (ou a dada) e o limite dado. */
async function configurar(
  c: PoolClient,
  p: { ativo?: boolean; inicio?: string; fim?: string; limite?: number } = {},
) {
  await c.query(
    `update configuracoes_clinica set whatsapp_ativo = $1, whatsapp_janela_inicio = $2,
       whatsapp_janela_fim = $3, whatsapp_limite_por_hora = $4`,
    [p.ativo ?? true, p.inicio ?? "00:00", p.fim ?? "23:59:59.999999", p.limite ?? 60],
  );
}

/** Superusuário: avulsa pendente (padrão: agendada há 1 minuto). */
async function avulsa(
  c: PoolClient,
  p: { ha?: string; status?: string; texto?: string; extra?: string } = {},
): Promise<string> {
  const r = await c.query<{ id: string }>(
    `insert into fila_mensagens (tipo, cliente_id, telefone, texto, agendado_para)
     values ('avulsa', $1, $2, $3, now() - $4::interval) returning id`,
    [cli, ZAP, p.texto ?? "Oi", p.ha ?? "1 minute"],
  );
  return r.rows[0].id;
}

/** Superusuário: mensagem já enviada há `ha`. */
async function enviada(c: PoolClient, ha: string) {
  await c.query(
    `insert into fila_mensagens (tipo, cliente_id, telefone, texto, agendado_para, status, enviada_em)
     values ('avulsa', $1, $2, 'x', now() - interval '2 hours', 'enviada', now() - $3::interval)`,
    [cli, ZAP, ha],
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
  profissional: string | null;
  inicio: Date | null;
  status_agendamento: string | null;
  clinica: string | null;
};

/** Chama proxima_mensagem como service_role e volta a superusuário. */
async function proxima(c: PoolClient): Promise<Proxima[]> {
  await comoServico(c);
  const r = await c.query<Proxima>("select * from proxima_mensagem()");
  await comoSuper(c);
  return r.rows;
}

async function servicoChama(c: PoolClient, sql: string, params: unknown[] = []) {
  await comoServico(c);
  const r = await c.query(sql, params);
  await comoSuper(c);
  return r;
}

async function msg(c: PoolClient, id: string) {
  return (
    await c.query<{
      status: string;
      tentativas: number;
      proxima_tentativa_em: Date | null;
      erro: string | null;
      texto: string | null;
      id_externo: string | null;
      enviada_em: Date | null;
      cancelada_motivo: string | null;
      agora: Date;
    }>(
      `select status::text, tentativas, proxima_tentativa_em, erro, texto, id_externo,
              enviada_em, cancelada_motivo, now() as agora
       from fila_mensagens where id = $1`,
      [id],
    )
  ).rows[0];
}

/** Superusuário: agendamento com início `daqui` (intervalo SQL) a partir de agora. */
async function agendar(
  c: PoolClient,
  p: { daqui?: string; status?: string; cliente?: string } = {},
): Promise<string> {
  const r = await c.query<{ id: string }>(
    `insert into agendamentos (cliente_id, profissional_id, servico_id, inicio, fim, status)
     values ($1, $2, $3, now() + $4::interval, now() + $4::interval + interval '30 minutes', $5)
     returning id`,
    [p.cliente ?? cli, profId, servico, p.daqui ?? "48 hours", p.status ?? "pendente"],
  );
  return r.rows[0].id;
}

async function statusAg(c: PoolClient, id: string): Promise<string> {
  return (await c.query<{ s: string }>("select status::text as s from agendamentos where id = $1", [id]))
    .rows[0].s;
}

type Recebida = {
  id: string;
  telefone: string;
  texto: string;
  agendamento_id: string | null;
  cliente_id: string | null;
  classificacao: string;
};

async function receber(c: PoolClient, telefone: string, texto: string, idExterno: string) {
  const r = await servicoChama(c, "select registrar_recebida($1, $2, $3) as id", [
    telefone,
    texto,
    idExterno,
  ]);
  const id = r.rows[0].id as string;
  return (
    await c.query<Recebida>(
      `select id, telefone, texto, agendamento_id, cliente_id, classificacao
       from mensagens_recebidas where id = $1`,
      [id],
    )
  ).rows[0];
}

const MIN = 60_000;

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
         values ('Maria Silva', $1, now()) returning id`,
        [ZAP],
      )
    ).rows[0].id;
    cli2 = (
      await c.query<{ id: string }>(
        `insert into clientes (nome, whatsapp, aceite_lgpd_em)
         values ('Joana Souza', $1, now()) returning id`,
        [ZAP2],
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

describe("estrutura e permissões", () => {
  it("funções security definer com execute só para quem deve", async () => {
    const f = await comoSuperusuario(async (c) =>
      (
        await c.query(
          `select p.proname, has_function_privilege('authenticated', p.oid, 'execute') as auth,
                  has_function_privilege('anon', p.oid, 'execute') as anon,
                  has_function_privilege('service_role', p.oid, 'execute') as service,
                  p.prosecdef as definer
           from pg_proc p
           where p.pronamespace = 'public'::regnamespace
             and p.proname in ('proxima_mensagem', 'concluir_envio', 'falhar_envio',
                               'descartar_envio', 'registrar_recebida', 'marcar_recebida_lida',
                               'gravar_status_whatsapp', 'disparar_relogio_whatsapp',
                               'classificar_resposta')
           order by p.proname`,
        )
      ).rows,
    );
    const svc = { auth: false, anon: false, service: true, definer: true };
    const nada = { auth: false, anon: false, service: false };
    expect(f).toEqual([
      { proname: "classificar_resposta", ...nada, definer: false },
      { proname: "concluir_envio", ...svc },
      { proname: "descartar_envio", ...svc },
      { proname: "disparar_relogio_whatsapp", ...nada, definer: true },
      { proname: "falhar_envio", ...svc },
      { proname: "gravar_status_whatsapp", ...svc },
      { proname: "marcar_recebida_lida", auth: true, anon: false, service: true, definer: true },
      { proname: "proxima_mensagem", ...svc },
      { proname: "registrar_recebida", ...svc },
    ]);
  });

  it("authenticated não executa proxima_mensagem nem registrar_recebida", async () => {
    await comoUsuario(dona, async (c) => {
      await falha(c, "select * from proxima_mensagem()", [], "42501");
      await falha(c, "select registrar_recebida('5511987654321', '1', 'x')", [], "42501");
      await falha(c, "select gravar_status_whatsapp('conectado')", [], "42501");
    });
  });

  it("service_role não altera a fila diretamente (só pelas funções)", async () => {
    await emTeste(async (c) => {
      const id = await avulsa(c);
      await comoServico(c);
      await falha(c, "update fila_mensagens set status = 'enviada' where id = $1", [id], "42501");
      await falha(
        c,
        "insert into mensagens_recebidas (telefone, texto, id_externo, classificacao) values ('1', 'x', 'y', 'para_ler')",
        [],
        "42501",
      );
      // Leitura continua liberada.
      const r = await c.query("select status::text from fila_mensagens where id = $1", [id]);
      expect(r.rows[0].status).toBe("pendente");
    });
  });
});

describe("proxima_mensagem — ritmo, janela e liga/desliga", () => {
  it("desligado → 0 linhas e nada muda", async () => {
    await emTeste(async (c) => {
      await configurar(c, { ativo: false });
      const id = await avulsa(c);
      expect(await proxima(c)).toEqual([]);
      expect((await msg(c, id)).status).toBe("pendente");
    });
  });

  it("ligado fora da janela → 0", async () => {
    await emTeste(async (c) => {
      const h = (
        await c.query<{ h: number }>(
          "select extract(hour from now() at time zone 'America/Sao_Paulo')::int as h",
        )
      ).rows[0].h;
      // Uma janela de 1h que certamente não contém a hora atual (SP).
      await configurar(c, h < 12 ? { inicio: "13:00", fim: "14:00" } : { inicio: "01:00", fim: "02:00" });
      const id = await avulsa(c);
      expect(await proxima(c)).toEqual([]);
      expect((await msg(c, id)).status).toBe("pendente");
    });
  });

  it("dentro → 1 linha, fica enviando; segunda chamada no mesmo minuto → 0", async () => {
    await emTeste(async (c) => {
      await configurar(c);
      const a = await avulsa(c, { texto: "Olá, Maria", ha: "2 minutes" });
      const b = await avulsa(c);
      const r = await proxima(c);
      expect(r).toHaveLength(1);
      expect(r[0]).toMatchObject({
        id: a,
        tipo: "avulsa",
        telefone: ZAP,
        texto: "Olá, Maria",
        variacoes: null,
        nome: "Maria Silva",
        clinica: "Madame Fé",
        inicio: null,
        status_agendamento: null,
      });
      expect((await msg(c, a)).status).toBe("enviando");
      // Uma em envio segura a próxima (1 por minuto).
      expect(await proxima(c)).toEqual([]);
      expect((await msg(c, b)).status).toBe("pendente");
    });
  });

  it("enviada há 20 s → 0; enviada há 2 min → 1", async () => {
    await emTeste(async (c) => {
      await configurar(c);
      await avulsa(c);
      await enviada(c, "20 seconds");
      expect(await proxima(c)).toEqual([]);
    });
    await emTeste(async (c) => {
      await configurar(c);
      await avulsa(c);
      await enviada(c, "2 minutes");
      expect(await proxima(c)).toHaveLength(1);
    });
  });

  it("enviadas na última hora = limite → 0; abaixo do limite → 1", async () => {
    await emTeste(async (c) => {
      await configurar(c, { limite: 2 });
      await avulsa(c);
      await enviada(c, "30 minutes");
      await enviada(c, "50 minutes");
      await enviada(c, "70 minutes"); // fora da última hora
      expect(await proxima(c)).toEqual([]);
    });
    await emTeste(async (c) => {
      await configurar(c, { limite: 2 });
      await avulsa(c);
      await enviada(c, "30 minutes");
      await enviada(c, "70 minutes");
      expect(await proxima(c)).toHaveLength(1);
    });
  });

  it("pega a mais antiga já vencida; ignora futuras e com nova tentativa no futuro", async () => {
    await emTeste(async (c) => {
      await configurar(c);
      await avulsa(c, { ha: "-10 minutes" }); // futura
      const adiada = await avulsa(c, { ha: "3 hours" });
      await c.query(
        "update fila_mensagens set proxima_tentativa_em = now() + interval '5 minutes' where id = $1",
        [adiada],
      );
      const nova = await avulsa(c, { ha: "1 minute" });
      const velha = await avulsa(c, { ha: "2 hours" });
      expect((await proxima(c)).map((m) => m.id)).toEqual([velha]);
      expect((await msg(c, nova)).status).toBe("pendente");
      expect((await msg(c, adiada)).status).toBe("pendente");
    });
  });

  it("modelo desativado → a vencida vira cancelada ('Modelo desativado') e segue para a próxima", async () => {
    await emTeste(async (c) => {
      await configurar(c);
      await c.query("update modelos_mensagem set ativo = false where tipo = 'confirmacao'");
      const ag = await agendar(c, { daqui: "3 hours" }); // confirmação agora + lembrete futuro
      const conf = (
        await c.query<{ id: string }>(
          "select id from fila_mensagens where agendamento_id = $1 and tipo = 'confirmacao'",
          [ag],
        )
      ).rows[0].id;
      // A confirmação é a mais antiga: seria a escolhida se o modelo estivesse ativo.
      await c.query(
        "update fila_mensagens set agendado_para = now() - interval '1 hour' where id = $1",
        [conf],
      );
      const a = await avulsa(c, { ha: "1 minute" });
      expect((await proxima(c)).map((m) => m.id)).toEqual([a]);
      expect(await msg(c, conf)).toMatchObject({
        status: "cancelada",
        cancelada_motivo: "Modelo desativado",
      });
    });
  });

  it("pós-atendimento, aniversário e respostas de pedido com mais de 24 h de atraso → canceladas ('Mensagem perdeu a validade')", async () => {
    await emTeste(async (c) => {
      await configurar(c);
      const inserir = async (tipo: string, ha: string) =>
        (
          await c.query<{ id: string }>(
            `insert into fila_mensagens (tipo, cliente_id, telefone, agendado_para)
             values ($1, $2, $3, now() - $4::interval) returning id`,
            [tipo, cli, ZAP, ha],
          )
        ).rows[0].id;
      const velhas = [
        await inserir("pos_atendimento", "25 hours"),
        await inserir("aniversario", "3 days"),
        await inserir("pedido_aprovado", "25 hours"),
        await inserir("pedido_recusado", "25 hours"),
      ];
      // No limite (23 h) ainda vale; avulsa atrasada não perde a validade.
      const dentro = await inserir("pos_atendimento", "23 hours");
      const avulsaVelha = (
        await c.query<{ id: string }>(
          `insert into fila_mensagens (tipo, cliente_id, telefone, texto, agendado_para)
           values ('avulsa', $1, $2, 'Oi', now() - interval '2 days') returning id`,
          [cli, ZAP],
        )
      ).rows[0].id;
      expect((await proxima(c)).map((m) => m.id)).toEqual([avulsaVelha]);
      for (const id of velhas) {
        expect(await msg(c, id)).toMatchObject({
          status: "cancelada",
          cancelada_motivo: "Mensagem perdeu a validade",
        });
      }
      expect((await msg(c, dentro)).status).toBe("pendente");
    });
  });

  it("enviando travada há mais de 10 min → falhou ('Envio interrompido') e não segura a fila", async () => {
    await emTeste(async (c) => {
      await configurar(c);
      const presa = (
        await c.query<{ id: string }>(
          `insert into fila_mensagens (tipo, cliente_id, telefone, texto, agendado_para, status, atualizado_em)
           values ('avulsa', $1, $2, 'x', now() - interval '1 hour', 'enviando', now() - interval '11 minutes')
           returning id`,
          [cli, ZAP],
        )
      ).rows[0].id;
      const a = await avulsa(c);
      expect((await proxima(c)).map((m) => m.id)).toEqual([a]);
      expect(await msg(c, presa)).toMatchObject({
        status: "falhou",
        erro: "Envio interrompido sem confirmação.",
        tentativas: 1,
      });
    });
  });

  it("confirmação devolve os dados para renderizar e o status atual do agendamento", async () => {
    await emTeste(async (c) => {
      await configurar(c);
      const ag = await agendar(c, { daqui: "3 hours" });
      // Já confirmado (ex.: pelo telefone) depois de enfileirar: a rota descarta.
      await c.query("update agendamentos set status = 'confirmado' where id = $1", [ag]);
      const r = await proxima(c);
      expect(r).toHaveLength(1);
      const ini = (await c.query<{ i: Date }>("select inicio as i from agendamentos where id = $1", [ag]))
        .rows[0].i;
      expect(r[0]).toMatchObject({
        tipo: "confirmacao",
        telefone: ZAP,
        texto: null,
        nome: "Maria Silva",
        servico: "Limpeza de pele",
        profissional: "Ana",
        status_agendamento: "confirmado",
        clinica: "Madame Fé",
      });
      expect(r[0].inicio!.getTime()).toBe(ini.getTime());
      expect(r[0].variacoes![0]).toMatch(/^Oi, \{nome\}! Passando para confirmar/);
    });
  });

  it("confirmação de horário que já passou (envio desligado por dias) é devolvida para descarte", async () => {
    await emTeste(async (c) => {
      await configurar(c);
      const ag = await agendar(c, { daqui: "3 hours" });
      await c.query(
        "update fila_mensagens set agendado_para = now() - interval '3 days' where agendamento_id = $1 and tipo = 'confirmacao'",
        [ag],
      );
      // Simula o início no passado sem disparar o gatilho (só o início muda).
      await c.query("alter table agendamentos disable trigger agendamentos_whatsapp");
      await c.query(
        "update agendamentos set inicio = now() - interval '2 days', fim = now() - interval '2 days' + interval '30 minutes' where id = $1",
        [ag],
      );
      await c.query("alter table agendamentos enable trigger agendamentos_whatsapp");
      const r = await proxima(c);
      expect(r).toHaveLength(1);
      expect(r[0].tipo).toBe("confirmacao");
      expect(r[0].inicio!.getTime()).toBeLessThan(Date.now());
      await servicoChama(c, "select descartar_envio($1, $2)", [r[0].id, "Horário já passou"]);
      expect(await msg(c, r[0].id)).toMatchObject({
        status: "cancelada",
        cancelada_motivo: "Horário já passou",
      });
    });
  });

  it("pedido recusado (sem cliente): nome, serviço e profissional do pedido", async () => {
    await emTeste(async (c) => {
      await configurar(c);
      const p = (
        await c.query<{ id: string }>(
          `insert into pedidos_online (servico_id, profissional_id, inicio, fim, nome, whatsapp,
             aceite_privacidade_em)
           values ($1, $2, now() + interval '3 days', now() + interval '3 days 30 minutes',
             'Carla Dias', '5511955554444', now()) returning id`,
          [servico, profId],
        )
      ).rows[0].id;
      await c.query("update pedidos_online set status = 'recusado' where id = $1", [p]);
      const r = await proxima(c);
      expect(r).toHaveLength(1);
      expect(r[0]).toMatchObject({
        tipo: "pedido_recusado",
        telefone: "5511955554444",
        nome: "Carla Dias",
        servico: "Limpeza de pele",
        profissional: "Ana",
        status_agendamento: null,
      });
      expect(r[0].inicio).not.toBeNull();
    });
  });
});

describe("proxima_mensagem — duas execuções do relógio ao mesmo tempo", () => {
  it("só uma recebe mensagem (trava + 1 por minuto)", async () => {
    const ids = await comoSuperusuario(async (c) => {
      await configurar(c);
      return [await avulsa(c, { ha: "2 minutes" }), await avulsa(c, { ha: "1 minute" })];
    });
    const a = new pg.Client({ connectionString: URL_TESTE });
    const b = new pg.Client({ connectionString: URL_TESTE });
    await a.connect();
    await b.connect();
    try {
      for (const x of [a, b]) {
        await x.query("begin");
        await x.query("set local role service_role");
      }
      const ra = await a.query("select id from proxima_mensagem()");
      // b espera a trava de a; quando a confirma, vê a mensagem em envio.
      const pb = b.query("select id from proxima_mensagem()");
      await new Promise((r) => setTimeout(r, 300));
      await a.query("commit");
      const rb = await pb;
      await b.query("commit");
      expect(ra.rows.length + rb.rows.length).toBe(1);
      expect(ra.rows[0].id).toBe(ids[0]);
    } finally {
      await a.end();
      await b.end();
      await comoSuperusuario(async (c) => {
        await c.query("delete from fila_mensagens where id = any($1)", [ids]);
        await c.query("update configuracoes_clinica set whatsapp_ativo = false");
      });
    }
  });
});

describe("concluir, falhar e descartar", () => {
  it("falhar_envio 3× → +5 min, +15 min e depois falhou com o erro", async () => {
    await emTeste(async (c) => {
      await configurar(c);
      const id = await avulsa(c);
      expect((await proxima(c)).map((m) => m.id)).toEqual([id]);

      await servicoChama(c, "select falhar_envio($1, $2)", [id, "Erro 500"]);
      let m = await msg(c, id);
      expect(m).toMatchObject({ status: "pendente", tentativas: 1, erro: "Erro 500" });
      expect(m.proxima_tentativa_em!.getTime() - m.agora.getTime()).toBe(5 * MIN);

      await c.query("update fila_mensagens set status = 'enviando' where id = $1", [id]);
      await servicoChama(c, "select falhar_envio($1, $2)", [id, "Tempo esgotado"]);
      m = await msg(c, id);
      expect(m).toMatchObject({ status: "pendente", tentativas: 2, erro: "Tempo esgotado" });
      expect(m.proxima_tentativa_em!.getTime() - m.agora.getTime()).toBe(15 * MIN);

      await c.query("update fila_mensagens set status = 'enviando' where id = $1", [id]);
      await servicoChama(c, "select falhar_envio($1, $2)", [id, "Desconectado"]);
      m = await msg(c, id);
      expect(m).toMatchObject({
        status: "falhou",
        tentativas: 3,
        erro: "Desconectado",
        proxima_tentativa_em: null,
      });
    });
  });

  it("concluir_envio grava texto, id externo e enviada_em", async () => {
    await emTeste(async (c) => {
      await configurar(c);
      const ag = await agendar(c, { daqui: "3 hours" });
      const [r] = await proxima(c);
      expect(r.tipo).toBe("confirmacao");
      await servicoChama(c, "select concluir_envio($1, $2, $3)", [r.id, "Oi, Maria!", "ZAP-1"]);
      const m = await msg(c, r.id);
      expect(m).toMatchObject({ status: "enviada", texto: "Oi, Maria!", id_externo: "ZAP-1" });
      expect(m.enviada_em!.getTime()).toBe(m.agora.getTime());
      expect(ag).toBeTruthy();
      // Concluir de novo (não está mais em envio) → erro.
      await comoServico(c);
      await falha(c, "select concluir_envio($1, 'x', 'y')", [r.id]);
    });
  });

  it("concluir avulsa sem texto mantém o texto pronto", async () => {
    await emTeste(async (c) => {
      await configurar(c);
      const id = await avulsa(c, { texto: "Texto pronto" });
      await proxima(c);
      await servicoChama(c, "select concluir_envio($1, null, 'ZAP-2')", [id]);
      expect(await msg(c, id)).toMatchObject({ status: "enviada", texto: "Texto pronto" });
    });
  });

  it("falhar/descartar fora de envio → erro; descartar → cancelada com o motivo", async () => {
    await emTeste(async (c) => {
      await configurar(c);
      const id = await avulsa(c);
      await comoServico(c);
      await falha(c, "select falhar_envio($1, 'x')", [id]);
      await falha(c, "select descartar_envio($1, 'x')", [id]);
      await comoSuper(c);
      await proxima(c);
      await servicoChama(c, "select descartar_envio($1, $2)", [id, "Agendamento não está mais pendente"]);
      expect(await msg(c, id)).toMatchObject({
        status: "cancelada",
        cancelada_motivo: "Agendamento não está mais pendente",
      });
    });
  });
});

describe("registrar_recebida", () => {
  it("'1' com dois agendamentos futuros pendentes confirma só o próximo; mesmo id externo não duplica", async () => {
    await emTeste(async (c) => {
      const depois = await agendar(c, { daqui: "5 days" });
      const proximo = await agendar(c, { daqui: "2 days" });
      const r = await receber(c, ZAP, " 1 ", "MSG-1");
      expect(r).toMatchObject({
        telefone: ZAP,
        texto: " 1 ",
        agendamento_id: proximo,
        cliente_id: cli,
        classificacao: "confirmou",
      });
      expect(await statusAg(c, proximo)).toBe("confirmado");
      expect(await statusAg(c, depois)).toBe("pendente");

      // Repetida (mesmo id externo): mesma linha, nada novo.
      const again = await receber(c, ZAP, "1", "MSG-1");
      expect(again.id).toBe(r.id);
      expect(
        (await c.query("select count(*)::int as n from mensagens_recebidas where id_externo = 'MSG-1'"))
          .rows[0].n,
      ).toBe(1);
      expect(await statusAg(c, depois)).toBe("pendente");

      // Outro "1": o próximo já está confirmado → não confirma o seguinte.
      const outro = await receber(c, ZAP, "sim", "MSG-2");
      expect(outro).toMatchObject({ agendamento_id: proximo, classificacao: "confirmou" });
      expect(await statusAg(c, depois)).toBe("pendente");
    });
  });

  it("classificação: '2' → quer_remarcar (sem mudar o agendamento); 'obrigada' → para_ler", async () => {
    await emTeste(async (c) => {
      const ag = await agendar(c, { daqui: "2 days" });
      const dois = await receber(c, ZAP, "2.", "MSG-3");
      expect(dois).toMatchObject({ classificacao: "quer_remarcar", agendamento_id: ag });
      expect(await statusAg(c, ag)).toBe("pendente");
      expect((await receber(c, ZAP, "obrigada", "MSG-4")).classificacao).toBe("para_ler");
      expect((await receber(c, ZAP, "Quero remarcar", "MSG-5")).classificacao).toBe("para_ler");
      expect((await receber(c, ZAP, "\n Confirmo\n", "MSG-6")).classificacao).toBe("confirmou");
      expect(await statusAg(c, ag)).toBe("confirmado");
    });
  });

  it("classificar_resposta segue a tabela das Global Constraints", async () => {
    await emTeste(async (c) => {
      const casos: [string, string][] = [
        ["1", "confirmou"],
        ["1.", "confirmou"],
        [" SIM ", "confirmou"],
        ["confirmo", "confirmou"],
        ["Confirmar", "confirmou"],
        ["2", "quer_remarcar"],
        ["2.", "quer_remarcar"],
        ["12", "para_ler"],
        ["", "para_ler"],
        ["Quero remarcar", "para_ler"],
      ];
      for (const [t, esperado] of casos) {
        const r = await c.query("select classificar_resposta($1) as v", [t]);
        expect([t, r.rows[0].v]).toEqual([t, esperado]);
      }
    });
  });

  it("telefone desconhecido → gravada sem agendamento nem cliente, para ler", async () => {
    await emTeste(async (c) => {
      const r = await receber(c, "5511900000000", "1", "MSG-7");
      expect(r).toMatchObject({ agendamento_id: null, cliente_id: null, classificacao: "para_ler" });
    });
  });

  it("WhatsApp com 12 dígitos (sem o 9) acha a cliente de 13 e confirma", async () => {
    await emTeste(async (c) => {
      const ag = await agendar(c, { daqui: "2 days" });
      // ZAP = 55 11 9 87654321 → o WhatsApp manda 55 11 87654321.
      const r = await receber(c, "551187654321", "1", "MSG-12D");
      expect(r).toMatchObject({
        telefone: "551187654321",
        agendamento_id: ag,
        cliente_id: cli,
        classificacao: "confirmou",
      });
      expect(await statusAg(c, ag)).toBe("confirmado");
    });
  });

  it("WhatsApp com 13 dígitos acha a cliente gravada com 12 (sem o 9)", async () => {
    await emTeste(async (c) => {
      const antiga = (
        await c.query<{ id: string }>(
          `insert into clientes (nome, whatsapp, aceite_lgpd_em)
           values ('Rita Antiga', '552187654321', now()) returning id`,
        )
      ).rows[0].id;
      const ag = await agendar(c, { daqui: "2 days", cliente: antiga });
      const r = await receber(c, "+55 (21) 98765-4321", "2", "MSG-13D");
      expect(r).toMatchObject({
        telefone: "5521987654321",
        agendamento_id: ag,
        cliente_id: antiga,
        classificacao: "quer_remarcar",
      });
    });
  });

  it("'1' ou '2' de cliente sem agendamento → para_ler (alguém precisa ver)", async () => {
    await emTeste(async (c) => {
      const um = await receber(c, ZAP, "1", "MSG-SEM-AG-1");
      expect(um).toMatchObject({ agendamento_id: null, cliente_id: cli, classificacao: "para_ler" });
      const dois = await receber(c, "551187654321", "2", "MSG-SEM-AG-2");
      expect(dois).toMatchObject({ agendamento_id: null, cliente_id: cli, classificacao: "para_ler" });
    });
  });

  it("sem identificador externo (nulo ou em branco) → P0001", async () => {
    await emTeste(async (c) => {
      for (const id of [null, "", "   "]) {
        await comoServico(c);
        const erro = await falha(c, "select registrar_recebida($1, '1', $2)", [ZAP, id]);
        expect(erro.message).toBe("Mensagem sem identificador.");
        await comoSuper(c);
      }
      expect(await contar(c, "mensagens_recebidas")).toBe(0);
    });
  });

  it("associa a atendimento começado há 1h; ignora há 3h e cancelados; cliente sem agendamento", async () => {
    await emTeste(async (c) => {
      await agendar(c, { daqui: "-3 hours", cliente: cli2, status: "confirmado" });
      const cancelado = await agendar(c, { daqui: "-30 minutes", cliente: cli2 });
      await c.query("update agendamentos set status = 'cancelado' where id = $1", [cancelado]);
      const agora = await agendar(c, { daqui: "-1 hour", cliente: cli2, status: "confirmado" });
      await agendar(c, { daqui: "3 days", cliente: cli2 });
      const r = await receber(c, ZAP2, "Cheguei", "MSG-8");
      expect(r).toMatchObject({ agendamento_id: agora, cliente_id: cli2 });

      // Cliente com WhatsApp e nenhum agendamento futuro → só a cliente.
      const s = await receber(c, ZAP, "Oi", "MSG-9");
      expect(s).toMatchObject({ agendamento_id: null, cliente_id: cli });
    });
  });
});

describe("mensagens_recebidas — RLS e marcar como lida", () => {
  it("dona e recepção leem; profissional não; anon e escrita direta → 42501", async () => {
    await comoSuperusuario(async (c) => {
      await c.query(
        `insert into mensagens_recebidas (telefone, texto, id_externo, classificacao)
         values ($1, 'Oi', 'RLS-1', 'para_ler')`,
        [ZAP],
      );
    });
    try {
      for (const uid of [dona, recepcao]) {
        await comoUsuario(uid, async (c) => {
          expect(await contar(c, "mensagens_recebidas")).toBe(1);
          await falha(
            c,
            "insert into mensagens_recebidas (telefone, texto, id_externo, classificacao) values ('1','x','y','para_ler')",
            [],
            "42501",
          );
          await falha(c, "update mensagens_recebidas set lida_em = now()", [], "42501");
          await falha(c, "delete from mensagens_recebidas", [], "42501");
        });
      }
      await comoUsuario(prof, async (c) => {
        expect(await contar(c, "mensagens_recebidas")).toBe(0);
      });
      await comoUsuario(null, async (c) => {
        await esperarErroSql(c.query("select * from mensagens_recebidas"), "42501");
      });
    } finally {
      await comoSuperusuario(async (c) => {
        await c.query("delete from mensagens_recebidas where id_externo = 'RLS-1'");
      });
    }
  });

  it("marcar_recebida_lida: recepção marca (lida_em/lida_por); profissional → P0001", async () => {
    await emTeste(async (c) => {
      const r = await receber(c, ZAP, "Oi", "LIDA-1");
      await logarComo(c, prof);
      const e = await falha(c, "select marcar_recebida_lida($1)", [r.id]);
      expect(e.message).toBe(MSG_EQUIPE);
      await logarComo(c, recepcao);
      await c.query("select marcar_recebida_lida($1)", [r.id]);
      const l = await c.query<{ lida_em: Date | null; lida_por: string | null; quem: string }>(
        `select m.lida_em, m.lida_por, colaborador_atual_id() as quem
         from mensagens_recebidas m where m.id = $1`,
        [r.id],
      );
      expect(l.rows[0].lida_em).not.toBeNull();
      expect(l.rows[0].lida_por).toBe(l.rows[0].quem);
      // De novo: não muda nada nem falha.
      await c.query("select marcar_recebida_lida($1)", [r.id]);
      const e2 = await falha(c, "select marcar_recebida_lida($1)", [
        "00000000-0000-0000-0000-000000000000",
      ]);
      expect(e2.message).toBe("Mensagem não encontrada.");
    });
  });
});

describe("relógio e status da conexão", () => {
  it("whatsapp_relogio: 1 linha com token de 64 hex e url nula; só service_role lê", async () => {
    await emTeste(async (c) => {
      const r = await c.query("select linha_unica, token, url from whatsapp_relogio");
      expect(r.rows).toHaveLength(1);
      expect(r.rows[0].token).toMatch(/^[0-9a-f]{64}$/);
      expect(r.rows[0].url).toBeNull();
      await falha(c, "insert into whatsapp_relogio (linha_unica) values (false)", [], "23514");

      await comoServico(c);
      expect((await c.query("select token from whatsapp_relogio")).rows[0].token).toBe(r.rows[0].token);
      await falha(c, "update whatsapp_relogio set url = 'https://x.com'", [], "42501");
    });
    await comoUsuario(dona, async (c) => {
      await esperarErroSql(c.query("select token from whatsapp_relogio"), "42501");
    });
    await comoUsuario(null, async (c) => {
      await esperarErroSql(c.query("select token from whatsapp_relogio"), "42501");
    });
  });

  it("disparar_relogio_whatsapp() com url nula (ou sem pg_net) não falha", async () => {
    await emTeste(async (c) => {
      await c.query("select disparar_relogio_whatsapp()");
      await c.query("update whatsapp_relogio set url = 'https://exemplo.vercel.app/'");
      const avisos: string[] = [];
      const ouvir = (n: { message?: string }) => {
        avisos.push(n.message ?? "");
      };
      c.on("notice", ouvir);
      try {
        await c.query("select disparar_relogio_whatsapp()");
      } finally {
        c.off("notice", ouvir);
      }
      const temPgNet = (
        await c.query(
          "select to_regprocedure('net.http_post(text, jsonb, jsonb, jsonb, integer)') is not null as ok",
        )
      ).rows[0].ok;
      if (!temPgNet) {
        expect(avisos).toContain("WhatsApp: pg_net não está instalada; o relógio não fará nada.");
      }
    });
  });

  it("whatsapp_status: sem_chaves por padrão; dona/recepção leem; gravar_status_whatsapp", async () => {
    await comoUsuario(recepcao, async (c) => {
      const r = await c.query("select estado, verificado_em from whatsapp_status");
      expect(r.rows).toEqual([{ estado: "sem_chaves", verificado_em: null }]);
      await falha(c, "update whatsapp_status set estado = 'conectado'", [], "42501");
    });
    await comoUsuario(prof, async (c) => {
      expect(await contar(c, "whatsapp_status")).toBe(0);
    });
    await comoUsuario(null, async (c) => {
      await esperarErroSql(c.query("select * from whatsapp_status"), "42501");
    });
    await emTeste(async (c) => {
      await servicoChama(c, "select gravar_status_whatsapp('conectado')");
      const r = await c.query<{ estado: string; ok: boolean }>(
        "select estado, verificado_em = now() as ok from whatsapp_status",
      );
      expect(r.rows).toEqual([{ estado: "conectado", ok: true }]);
      await comoServico(c);
      await falha(c, "select gravar_status_whatsapp('quebrado')", [], "23514");
    });
  });
});

describe("pós-atendimento atrasado (Ruling P3B-R3)", () => {
  it("atendido de 3 dias atrás → sem pós; de ontem → pós", async () => {
    await emTeste(async (c) => {
      const velho = await agendar(c, { daqui: "-3 days", status: "confirmado" });
      await c.query("update agendamentos set status = 'atendido' where id = $1", [velho]);
      const ontem = await agendar(c, { daqui: "-1 day", status: "confirmado" });
      await c.query("update agendamentos set status = 'atendido' where id = $1", [ontem]);
      const r = await c.query<{ agendamento_id: string }>(
        "select agendamento_id from fila_mensagens where tipo = 'pos_atendimento'",
      );
      expect(r.rows.map((x) => x.agendamento_id)).toEqual([ontem]);
    });
  });

  it("inserido já atendido há 10 dias (lançamento retroativo) → sem pós", async () => {
    await emTeste(async (c) => {
      const ag = await agendar(c, { daqui: "-10 days", status: "atendido" });
      expect(
        (await c.query("select count(*)::int as n from fila_mensagens where agendamento_id = $1", [ag]))
          .rows[0].n,
      ).toBe(0);
    });
  });
});
