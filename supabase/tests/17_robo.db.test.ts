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

// 0016/0017: robô de atendimento por menu (robo_config, robo_opcoes,
// robo_sessoes, robo_processar via registrar_recebida, pausa pela equipe,
// retomar_robo, salvar_robo, robo_pedidos_atendimento) e o tipo 'robo' na fila.

const MSG_DONA = "Apenas a dona pode alterar o robô.";
const MSG_EQUIPE = "Apenas a dona ou a recepção podem enviar mensagens.";

const ZAP = "5511987654321";
const ZAP_SEM_9 = "551187654321";
const DESCONHECIDO = "5521999998888";

const MENU =
  "Oi, Maria! 💕 Sou a assistente virtual da Madame Fé. Escolha uma opção digitando o número:\n\n" +
  "1 - Serviços e preços\n2 - Agendar horário\n3 - Endereço e horário\n4 - Falar com a equipe";
const NAO_ENTENDI = "Não entendi 😊 Digite o número de uma das opções ou 0 para ver o menu.";
const RODAPE = "Digite 0 para voltar ao menu.";
const EQUIPE = "Certo! Já avisei a equipe, em breve alguém te responde. 💕";

let dona: string;
let recepcao: string;
let prof: string;
let profId: string;
let cli: string;
let servico: string;
let seq = 0;

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

async function como<T>(c: PoolClient, uid: string, fn: () => Promise<T>): Promise<T> {
  await logarComo(c, uid);
  try {
    return await fn();
  } finally {
    await comoSuper(c);
  }
}

async function falha(c: PoolClient, sql: string, params: unknown[], sqlstate = "P0001") {
  await c.query("savepoint tentativa");
  const erro = await esperarErroSql(c.query(sql, params), sqlstate);
  await c.query("rollback to savepoint tentativa");
  return erro;
}

function emTeste<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  return comoUsuario(dona, async (c) => {
    await comoSuper(c);
    return fn(c);
  });
}

/** Liga o WhatsApp e o robô (padrão: sempre). */
async function ligar(c: PoolClient, quando = "sempre") {
  await c.query("update configuracoes_clinica set whatsapp_ativo = true");
  await c.query("update robo_config set ativo = true, quando = $1", [quando]);
}

/** Resposta recebida pelo webhook (service_role). */
async function receber(c: PoolClient, texto: string, telefone = ZAP): Promise<string> {
  seq += 1;
  await comoServico(c);
  const r = await c.query<{ id: string }>("select registrar_recebida($1, $2, $3) as id", [
    telefone,
    texto,
    `ext-${seq}`,
  ]);
  await comoSuper(c);
  return r.rows[0].id;
}

/** Textos do robô na fila (em ordem de criação). */
async function robo(c: PoolClient, telefone = ZAP): Promise<string[]> {
  const r = await c.query<{ texto: string }>(
    `select texto from fila_mensagens where tipo = 'robo' and telefone = $1
     order by criado_em, id`,
    [telefone],
  );
  return r.rows.map((x) => x.texto);
}

/** Recebe e devolve só o que o robô enfileirou com essa mensagem. */
async function conversar(c: PoolClient, texto: string, telefone = ZAP): Promise<string[]> {
  // Na mesma transação criado_em é igual para todas: compara pelos ids.
  const ids = async () =>
    (
      await c.query<{ id: string; texto: string }>(
        "select id, texto from fila_mensagens where tipo = 'robo' and telefone = $1",
        [telefone],
      )
    ).rows;
  const antes = new Set((await ids()).map((x) => x.id));
  await receber(c, texto, telefone);
  return (await ids()).filter((x) => !antes.has(x.id)).map((x) => x.texto);
}

async function sessao(c: PoolClient, telefone = ZAP) {
  return (
    await c.query<{
      cliente_id: string | null;
      menu_enviado_em: Date | null;
      nao_entendi_em: Date | null;
      pausado_ate: Date | null;
      pediu_equipe_em: Date | null;
    }>("select * from robo_sessoes where telefone = $1", [telefone])
  ).rows[0];
}

/** Recua os horários da sessão (simula o tempo passando). */
async function recuar(c: PoolClient, intervalo: string, telefone = ZAP) {
  await c.query(
    `update robo_sessoes set
       menu_enviado_em = menu_enviado_em - $2::interval,
       nao_entendi_em = nao_entendi_em - $2::interval,
       pausado_ate = pausado_ate - $2::interval,
       pediu_equipe_em = pediu_equipe_em - $2::interval
     where telefone = $1`,
    [telefone, intervalo],
  );
}

/** Horário que cobre o dia atual inteiro (SP) ou nenhum dia. */
async function expediente(c: PoolClient, aberto: boolean) {
  const dia = (
    await c.query<{ d: string }>(
      "select extract(dow from now() at time zone 'America/Sao_Paulo')::int::text as d",
    )
  ).rows[0].d;
  const horario = aberto ? { [dia]: [{ inicio: "00:00", fim: "23:59" }] } : {};
  await c.query("update configuracoes_clinica set horario_funcionamento = $1", [horario]);
}

beforeAll(async () => {
  await resetarBanco();
  ({ uid: dona } = await criarUsuario("dona"));
  ({ uid: recepcao } = await criarUsuario("recepcao"));
  ({ uid: prof, colaboradorId: profId } = await criarUsuario("profissional", { nome: "Ana" }));

  await comoSuperusuario(async (c) => {
    await c.query(
      `insert into configuracoes_clinica (nome, endereco, horario_funcionamento)
       values ('Madame Fé', 'Rua das Flores, 10',
         '{"1":[{"inicio":"09:00","fim":"18:00"}],"2":[{"inicio":"09:00","fim":"18:00"}],
           "3":[{"inicio":"09:00","fim":"18:00"}],"4":[{"inicio":"09:00","fim":"18:00"}],
           "5":[{"inicio":"09:00","fim":"18:00"}],"6":[{"inicio":"09:00","fim":"13:00"}]}')`,
    );
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

describe("estrutura, sementes e permissões", () => {
  it("robo_config: linha única com os padrões", async () => {
    await emTeste(async (c) => {
      const r = await c.query("select * from robo_config");
      expect(r.rows).toHaveLength(1);
      expect(r.rows[0]).toMatchObject({
        ativo: false,
        quando: "sempre",
        boas_vindas:
          "Oi, {nome}! 💕 Sou a assistente virtual da {clinica}. Escolha uma opção digitando o número:",
        nao_entendi: NAO_ENTENDI,
        rodape_opcao: RODAPE,
        link_agendamento: null,
      });
      await falha(c, "insert into robo_config (linha_unica) values (false)", [], "23514");
      await falha(c, "update robo_config set boas_vindas = '  ' where linha_unica", [], "23514");
      await falha(c, "update robo_config set quando = 'nunca' where linha_unica", [], "23514");
    });
  });

  it("robo_opcoes: 4 sementes, número 1–8 único e resposta obrigatória no tipo texto", async () => {
    await emTeste(async (c) => {
      const r = await c.query(
        "select numero, rotulo, tipo, resposta, ativo from robo_opcoes order by numero",
      );
      expect(r.rows).toEqual([
        {
          numero: 1,
          rotulo: "Serviços e preços",
          tipo: "texto",
          resposta:
            "Confira nossos serviços e valores: ... (edite este texto em Configurações → WhatsApp → Robô)",
          ativo: true,
        },
        { numero: 2, rotulo: "Agendar horário", tipo: "agendar_online", resposta: null, ativo: true },
        {
          numero: 3,
          rotulo: "Endereço e horário",
          tipo: "texto",
          resposta: "Estamos em {endereco}. Horário: {horario}.",
          ativo: true,
        },
        { numero: 4, rotulo: "Falar com a equipe", tipo: "falar_com_equipe", resposta: null, ativo: true },
      ]);
      const ins = "insert into robo_opcoes (numero, rotulo, tipo, resposta) values ($1, $2, $3, $4)";
      await falha(c, ins, [9, "x", "falar_com_equipe", null], "23514");
      await falha(c, ins, [0, "x", "falar_com_equipe", null], "23514");
      await falha(c, ins, [1, "x", "falar_com_equipe", null], "23505");
      await falha(c, ins, [5, "x", "texto", null], "23514");
      await falha(c, ins, [5, "x", "texto", "  "], "23514");
      await falha(c, ins, [5, "", "falar_com_equipe", null], "23514");
      await falha(c, ins, [5, "x".repeat(61), "falar_com_equipe", null], "23514");
      await falha(c, ins, [5, "x", "texto", "y".repeat(1001)], "23514");
      await falha(c, ins, [5, "x", "outro", null], "23514");
    });
  });

  it("RLS: dona e recepção leem; recepção não altera; profissional nada", async () => {
    await emTeste(async (c) => {
      for (const uid of [dona, recepcao]) {
        await como(c, uid, async () => {
          expect((await c.query("select * from robo_config")).rows).toHaveLength(1);
          expect((await c.query("select * from robo_opcoes")).rows).toHaveLength(4);
          await c.query("select * from robo_sessoes");
        });
      }
      await como(c, prof, async () => {
        expect((await c.query("select * from robo_config")).rows).toHaveLength(0);
        expect((await c.query("select * from robo_opcoes")).rows).toHaveLength(0);
        expect((await c.query("select * from robo_sessoes")).rows).toHaveLength(0);
        const u = await c.query("update robo_config set ativo = true where linha_unica");
        expect(u.rowCount).toBe(0);
      });
      await como(c, recepcao, async () => {
        const u = await c.query("update robo_config set ativo = true where linha_unica");
        expect(u.rowCount).toBe(0);
        const o = await c.query("update robo_opcoes set rotulo = 'x' where numero = 1");
        expect(o.rowCount).toBe(0);
        const d = await c.query("delete from robo_opcoes where numero = 1");
        expect(d.rowCount).toBe(0);
        await falha(
          c,
          "insert into robo_opcoes (numero, rotulo, tipo) values (5, 'x', 'falar_com_equipe')",
          [],
          "42501",
        );
        await falha(c, "insert into robo_sessoes (telefone) values ($1)", [ZAP], "42501");
      });
      await como(c, dona, async () => {
        const u = await c.query("update robo_config set ativo = true where linha_unica");
        expect(u.rowCount).toBe(1);
        await c.query(
          "insert into robo_opcoes (numero, rotulo, tipo) values (5, 'Outra', 'falar_com_equipe')",
        );
        expect((await c.query("delete from robo_opcoes where numero = 5")).rowCount).toBe(1);
        await falha(c, "insert into robo_sessoes (telefone) values ($1)", [ZAP], "42501");
        await falha(c, "update robo_sessoes set pausado_ate = now()", [], "42501");
      });
    });
  });

  it("funções: robo_processar interna; retomar_robo/salvar_robo para autenticados", async () => {
    const f = await comoSuperusuario(async (c) =>
      (
        await c.query(
          `select p.proname, has_function_privilege('authenticated', p.oid, 'execute') as auth,
                  has_function_privilege('anon', p.oid, 'execute') as anon,
                  has_function_privilege('service_role', p.oid, 'execute') as service
           from pg_proc p
           where p.pronamespace = 'public'::regnamespace
             and p.proname in ('robo_processar', 'retomar_robo', 'salvar_robo',
                               'robo_pedidos_atendimento')
           order by p.proname`,
        )
      ).rows,
    );
    expect(f).toEqual([
      { proname: "retomar_robo", auth: true, anon: false, service: true },
      { proname: "robo_pedidos_atendimento", auth: true, anon: false, service: true },
      { proname: "robo_processar", auth: false, anon: false, service: false },
      { proname: "salvar_robo", auth: true, anon: false, service: true },
    ]);
  });

  it("fila: tipo robo exige texto", async () => {
    await emTeste(async (c) => {
      await falha(
        c,
        `insert into fila_mensagens (tipo, telefone, agendado_para) values ('robo', $1, now())`,
        [ZAP],
        "23514",
      );
    });
  });
});

describe("conversa com o robô", () => {
  it("primeira mensagem → menu com boas-vindas e opções ativas em ordem", async () => {
    await emTeste(async (c) => {
      await ligar(c);
      expect(await conversar(c, "Boa tarde!")).toEqual([MENU]);
      const s = await sessao(c);
      expect(s.cliente_id).toBe(cli);
      expect(s.menu_enviado_em).not.toBeNull();
      const f = await c.query(
        "select cliente_id, status::text, criado_por from fila_mensagens where tipo = 'robo'",
      );
      expect(f.rows).toEqual([{ cliente_id: cli, status: "pendente", criado_por: null }]);
    });
  });

  it("número sem o 9 encontra a cliente e responde no WhatsApp cadastrado", async () => {
    await emTeste(async (c) => {
      await ligar(c);
      await receber(c, "oi", ZAP_SEM_9);
      expect(await robo(c, ZAP)).toEqual([MENU]);
      expect(await sessao(c, ZAP)).toBeDefined();
    });
  });

  it("número desconhecido: menu sem nome ('Oi! 💕 ...')", async () => {
    await emTeste(async (c) => {
      await ligar(c);
      const [menu] = await conversar(c, "olá", DESCONHECIDO);
      expect(menu.startsWith("Oi! 💕 Sou a assistente virtual da Madame Fé.")).toBe(true);
      expect((await sessao(c, DESCONHECIDO)).cliente_id).toBeNull();
    });
  });

  it("opções desativadas não aparecem no menu e não respondem", async () => {
    await emTeste(async (c) => {
      await ligar(c);
      await c.query("update robo_opcoes set ativo = false where numero = 3");
      const [menu] = await conversar(c, "oi");
      expect(menu).not.toContain("3 - Endereço e horário");
      expect(await conversar(c, "3")).toEqual([NAO_ENTENDI]);
    });
  });

  it("'2' após o menu → link de agendamento + rodapé", async () => {
    await emTeste(async (c) => {
      await ligar(c);
      await c.query("update whatsapp_relogio set url = 'https://madame.exemplo.com/'");
      await conversar(c, "oi");
      expect(await conversar(c, " 2 ")).toEqual([
        `Agende pelo link: https://madame.exemplo.com/agendar\n\n${RODAPE}`,
      ]);
      // link_agendamento tem prioridade sobre a URL do relógio.
      await c.query(
        "update robo_config set link_agendamento = 'https://outro.exemplo.com/agendar' where linha_unica",
      );
      expect(await conversar(c, "2")).toEqual([
        `Agende pelo link: https://outro.exemplo.com/agendar\n\n${RODAPE}`,
      ]);
    });
  });

  it("'1' (texto) e '3' (endereço e horário renderizados)", async () => {
    await emTeste(async (c) => {
      await ligar(c);
      await conversar(c, "oi");
      expect(await conversar(c, "1")).toEqual([
        `Confira nossos serviços e valores: ... (edite este texto em Configurações → WhatsApp → Robô)\n\n${RODAPE}`,
      ]);
      expect(await conversar(c, "3")).toEqual([
        `Estamos em Rua das Flores, 10. Horário: seg a sex 09:00 às 18:00; sáb 09:00 às 13:00.\n\n${RODAPE}`,
      ]);
    });
  });

  it("'9' ou texto livre → 'não entendi' uma vez; a segunda vez, nada", async () => {
    await emTeste(async (c) => {
      await ligar(c);
      await conversar(c, "oi");
      await recuar(c, "1 minute");
      expect(await conversar(c, "9")).toEqual([NAO_ENTENDI]);
      expect(await conversar(c, "quanto custa a limpeza?")).toEqual([]);
      expect(await conversar(c, "9")).toEqual([]);
    });
  });

  it("'0' ou 'Menu' → menu de novo (e libera um novo 'não entendi')", async () => {
    await emTeste(async (c) => {
      await ligar(c);
      await conversar(c, "oi");
      await recuar(c, "5 minutes");
      expect(await conversar(c, "xyz")).toEqual([NAO_ENTENDI]);
      await recuar(c, "1 minute");
      expect(await conversar(c, "0")).toEqual([MENU]);
      expect(await conversar(c, " MENU ")).toEqual([MENU]);
      await recuar(c, "1 minute");
      expect(await conversar(c, "xyz")).toEqual([NAO_ENTENDI]);
    });
  });

  it("dígito com menu enviado há mais de 2 h → não é opção", async () => {
    await emTeste(async (c) => {
      await ligar(c);
      await conversar(c, "oi");
      await recuar(c, "3 hours");
      expect(await conversar(c, "1")).toEqual([NAO_ENTENDI]);
    });
  });

  it("menu reenviado depois de 12 h", async () => {
    await emTeste(async (c) => {
      await ligar(c);
      await conversar(c, "oi");
      await recuar(c, "13 hours");
      expect(await conversar(c, "tudo bem?")).toEqual([MENU]);
    });
  });

  it("'4' → mensagem da equipe e pausa de 24 h; durante a pausa, nada", async () => {
    await emTeste(async (c) => {
      await ligar(c);
      await conversar(c, "oi");
      expect(await conversar(c, "4")).toEqual([EQUIPE]);
      const s = await c.query<{ pausa: boolean; pediu: boolean }>(
        `select pausado_ate between now() + interval '23 hours 59 minutes' and now() + interval '24 hours 1 minute' as pausa,
                pediu_equipe_em = now() as pediu
         from robo_sessoes where telefone = $1`,
        [ZAP],
      );
      expect(s.rows[0]).toEqual({ pausa: true, pediu: true });
      expect(await conversar(c, "0")).toEqual([]);
      expect(await conversar(c, "oi")).toEqual([]);
      // Pausa vencida: volta a responder (menu de 25 h atrás → menu).
      await recuar(c, "25 hours");
      expect(await conversar(c, "oi")).toEqual([MENU]);
    });
  });

  it("robo_pedidos_atendimento: conta quem pediu nas últimas 24 h sem resposta da equipe", async () => {
    await emTeste(async (c) => {
      await ligar(c);
      await conversar(c, "oi");
      await conversar(c, "4");
      await conversar(c, "oi", DESCONHECIDO);
      await conversar(c, "4", DESCONHECIDO);
      const n = () =>
        como(c, recepcao, async () =>
          Number((await c.query("select robo_pedidos_atendimento() as n")).rows[0].n),
        );
      expect(await n()).toBe(2);
      await como(c, prof, async () => {
        expect(Number((await c.query("select robo_pedidos_atendimento() as n")).rows[0].n)).toBe(0);
      });
      // A equipe respondeu a Maria (avulsa depois do pedido).
      await recuar(c, "1 minute");
      await como(c, recepcao, () =>
        c.query("select enviar_avulsa($1, 'Oi Maria, aqui é a Bia!')", [cli]),
      );
      expect(await n()).toBe(1);
      // Pedido com mais de 24 h sai.
      await recuar(c, "25 hours", DESCONHECIDO);
      expect(await n()).toBe(0);
    });
  });

  it("avulsa da recepção pausa o robô por 24 h (cria a sessão se preciso)", async () => {
    await emTeste(async (c) => {
      await ligar(c);
      await como(c, recepcao, () => c.query("select enviar_avulsa($1, 'Oi Maria!')", [cli]));
      const s = await c.query<{ ok: boolean }>(
        `select pausado_ate between now() + interval '23 hours 59 minutes' and now() + interval '24 hours 1 minute' as ok
         from robo_sessoes where telefone = $1`,
        [ZAP],
      );
      expect(s.rows[0].ok).toBe(true);
      expect(await conversar(c, "oi")).toEqual([]);
      // Avulsa sem autor (sistema) não pausa.
      await c.query("update robo_sessoes set pausado_ate = null");
      await c.query(
        `insert into fila_mensagens (tipo, cliente_id, telefone, texto, agendado_para)
         values ('avulsa', $1, $2, 'x', now())`,
        [cli, ZAP],
      );
      expect((await sessao(c)).pausado_ate).toBeNull();
    });
  });

  it("retomar_robo limpa a pausa e o pedido; profissional não pode", async () => {
    await emTeste(async (c) => {
      await ligar(c);
      await conversar(c, "oi");
      await conversar(c, "4");
      await como(c, prof, () =>
        falha(c, "select retomar_robo($1)", [ZAP]).then((e) => expect(e.message).toBe(MSG_EQUIPE)),
      );
      await como(c, recepcao, () => c.query("select retomar_robo($1)", [ZAP]));
      const s = await sessao(c);
      expect(s.pausado_ate).toBeNull();
      expect(s.pediu_equipe_em).toBeNull();
      expect(await conversar(c, "1")).toHaveLength(1);
    });
  });

  it("'1' com confirmação pendente confirma o agendamento e o robô não responde", async () => {
    await emTeste(async (c) => {
      await ligar(c);
      const ag = (
        await c.query<{ id: string }>(
          `insert into agendamentos (cliente_id, profissional_id, servico_id, inicio, fim, status)
           values ($1, $2, $3, now() + interval '1 day', now() + interval '1 day 30 minutes', 'pendente')
           returning id`,
          [cli, profId, servico],
        )
      ).rows[0].id;
      expect(await conversar(c, "1")).toEqual([]);
      const st = await c.query("select status::text from agendamentos where id = $1", [ag]);
      expect(st.rows[0].status).toBe("confirmado");
      // Texto livre com agendamento: o robô responde normalmente.
      expect(await conversar(c, "obrigada")).toEqual([MENU]);
    });
  });

  it("robô inativo (ou WhatsApp desligado) → nada", async () => {
    await emTeste(async (c) => {
      expect(await conversar(c, "oi")).toEqual([]);
      expect(await sessao(c)).toBeUndefined();
      await ligar(c);
      await c.query("update configuracoes_clinica set whatsapp_ativo = false");
      expect(await conversar(c, "oi")).toEqual([]);
    });
  });

  it("'só fora do horário': dentro do expediente nada; fora, responde", async () => {
    await emTeste(async (c) => {
      await ligar(c, "fora_do_horario");
      await expediente(c, true);
      expect(await conversar(c, "oi")).toEqual([]);
      await expediente(c, false);
      expect(await conversar(c, "oi")).toEqual([MENU]);
    });
  });

  it("telefone fora do padrão: a resposta é registrada e o robô não responde", async () => {
    await emTeste(async (c) => {
      await ligar(c);
      const id = await receber(c, "oi", "abc");
      const r = await c.query("select texto from mensagens_recebidas where id = $1", [id]);
      expect(r.rows[0].texto).toBe("oi");
      expect(await robo(c, "abc")).toEqual([]);
    });
  });
});

describe("salvar_robo", () => {
  const SQL = `select salvar_robo($1, $2, $3, $4, $5, $6, $7::jsonb)`;
  const opcoes = [
    { numero: 1, rotulo: "Falar com a equipe", tipo: "falar_com_equipe", resposta: null, ativo: true },
    { numero: 2, rotulo: "Preços", tipo: "texto", resposta: "Limpeza R$ 200", ativo: false },
  ];

  it("dona salva configuração e substitui as opções (reordenando)", async () => {
    await emTeste(async (c) => {
      await como(c, dona, () =>
        c.query(SQL, [
          true,
          "fora_do_horario",
          "Olá {nome}!",
          "Hein?",
          "",
          "https://x.com/agendar",
          JSON.stringify(opcoes),
        ]),
      );
      const cfg = await c.query("select ativo, quando, boas_vindas, nao_entendi, rodape_opcao, link_agendamento from robo_config");
      expect(cfg.rows[0]).toEqual({
        ativo: true,
        quando: "fora_do_horario",
        boas_vindas: "Olá {nome}!",
        nao_entendi: "Hein?",
        rodape_opcao: "",
        link_agendamento: "https://x.com/agendar",
      });
      const o = await c.query(
        "select numero, rotulo, tipo, resposta, ativo from robo_opcoes order by numero",
      );
      expect(o.rows).toEqual(opcoes);
    });
  });

  it("recepção e profissional não salvam; dados inválidos → erro", async () => {
    await emTeste(async (c) => {
      const args = [true, "sempre", "Oi", "Hein?", "", null, JSON.stringify(opcoes)];
      for (const uid of [recepcao, prof]) {
        await como(c, uid, async () => {
          const e = await falha(c, SQL, args);
          expect(e.message).toBe(MSG_DONA);
        });
      }
      await como(c, dona, async () => {
        const repetido = [opcoes[0], { ...opcoes[1], numero: 1 }];
        await falha(c, SQL, [...args.slice(0, 6), JSON.stringify(repetido)], "23505");
        const nove = Array.from({ length: 9 }, (_, i) => ({ ...opcoes[0], numero: i + 1 }));
        await falha(c, SQL, [...args.slice(0, 6), JSON.stringify(nove)], "23514");
      });
    });
  });
});

describe("fila: tipo robo", () => {
  it("proxima_mensagem devolve o robô com o texto pronto e prioridade; validade de 24 h", async () => {
    await emTeste(async (c) => {
      await c.query(
        `update configuracoes_clinica set whatsapp_ativo = true, whatsapp_janela_inicio = '00:00',
           whatsapp_janela_fim = '23:59:59.999999'`,
      );
      await c.query(
        `insert into fila_mensagens (tipo, cliente_id, telefone, texto, agendado_para)
         values ('avulsa', $1, $2, 'antiga', now() - interval '10 minutes')`,
        [cli, ZAP],
      );
      const vencida = (
        await c.query<{ id: string }>(
          `insert into fila_mensagens (tipo, cliente_id, telefone, texto, agendado_para)
           values ('robo', $1, $2, 'velha', now() - interval '25 hours') returning id`,
          [cli, ZAP],
        )
      ).rows[0].id;
      await c.query(
        `insert into fila_mensagens (tipo, cliente_id, telefone, texto, agendado_para)
         values ('robo', $1, $2, 'menu', now() - interval '1 minute')`,
        [cli, ZAP],
      );
      await comoServico(c);
      const r = await c.query("select tipo::text, texto from proxima_mensagem()");
      await comoSuper(c);
      expect(r.rows).toEqual([{ tipo: "robo", texto: "menu" }]);
      const v = await c.query("select status::text, cancelada_motivo from fila_mensagens where id = $1", [
        vencida,
      ]);
      expect(v.rows[0]).toEqual({ status: "cancelada", cancelada_motivo: "Mensagem perdeu a validade" });
    });
  });

  it("reenviar_mensagem copia o texto do robô", async () => {
    await emTeste(async (c) => {
      const id = (
        await c.query<{ id: string }>(
          `insert into fila_mensagens (tipo, cliente_id, telefone, texto, agendado_para, status, tentativas)
           values ('robo', $1, $2, 'menu', now(), 'falhou', 3) returning id`,
          [cli, ZAP],
        )
      ).rows[0].id;
      const novo = await como(c, recepcao, async () =>
        (await c.query<{ id: string }>("select reenviar_mensagem($1) as id", [id])).rows[0].id,
      );
      const r = await c.query("select tipo::text, texto from fila_mensagens where id = $1", [novo]);
      expect(r.rows[0]).toEqual({ tipo: "robo", texto: "menu" });
    });
  });
});
