import type { PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  abrirConexao,
  aplicarMigracoes,
  comoSuperusuario,
  comoUsuario,
  contar,
  criarPacote,
  criarUsuario,
  esperarErroSql,
  fecharConexoes,
  resetarBanco,
} from "./helpers";

// 0007: pacotes de sessões (venda, consumo pelo status do agendamento,
// validade, cancelamento) e cobrança com pagamento dividido (1 a 4 partes).

const HOJE = "(now() at time zone 'America/Sao_Paulo')::date";
const COBRAR = "select registrar_cobranca($1, $2, $3, $4, $5::jsonb) as id";
const VENDER =
  "select vender_pacote($1, $2, $3, $4, $5::date, $6, $7::jsonb) as id";
const partes = (...p: object[]) => JSON.stringify(p);
const pix = (valor: number) => ({ forma: "pix", valor_centavos: valor, parcelas: 1 });

const MSG_ESGOTADO = "Todas as sessões do pacote já foram usadas.";
const MSG_NAO_ATIVO = "Este pacote não está ativo.";

let dona: string;
let donaId: string;
let recepcao: string;
let recepcaoId: string;
let profA: string;
let profAId: string;
let profB: string;
let cli: string;
let outraCli: string;
let servico: string;
let outroServico: string;

/** Troca o usuário logado dentro da transação atual. */
async function logarComo(c: PoolClient, uid: string) {
  await c.query("set local role authenticated");
  await c.query("select set_config('request.jwt.claims', $1, true)", [
    JSON.stringify({ sub: uid, role: "authenticated" }),
  ]);
}

/** Volta a ser superusuário dentro da transação (fixtures com now() fixo). */
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

let hora = 0;
/** Superusuário: agendamento da profissional A (horários sem sobreposição). */
async function agendar(
  c: PoolClient,
  p: {
    status?: string;
    pacote?: string | null;
    cliente?: string;
    servico?: string;
    valor?: number;
    inicio?: string;
  } = {},
): Promise<string> {
  hora += 1;
  const inicio = p.inicio ?? new Date(Date.UTC(2030, 0, 1, hora)).toISOString();
  const r = await c.query<{ id: string }>(
    `insert into agendamentos (cliente_id, profissional_id, servico_id, inicio, fim,
       status, pacote_vendido_id, valor_previsto_centavos)
     values ($1, $2, $3, $4::timestamptz, $4::timestamptz + interval '30 minutes', $5, $6, $7)
     returning id`,
    [
      p.cliente ?? cli,
      profAId,
      p.servico ?? servico,
      inicio,
      p.status ?? "atendido",
      p.pacote ?? null,
      p.valor ?? 10000,
    ],
  );
  return r.rows[0].id;
}

async function linhas(c: PoolClient, sql: string, params: unknown[] = []) {
  return (await c.query(sql, params)).rows;
}

async function pacote(c: PoolClient, id: string) {
  return (
    await c.query<{ sessoes_usadas: number; status: string }>(
      "select sessoes_usadas, status::text as status from pacotes_vendidos where id = $1",
      [id],
    )
  ).rows[0];
}

async function cobrar(
  c: PoolClient,
  origem: string,
  agendamento: string | null,
  pacoteId: string | null,
  desconto: number,
  p: string,
): Promise<string> {
  return (await c.query<{ id: string }>(COBRAR, [origem, agendamento, pacoteId, desconto, p]))
    .rows[0].id;
}

async function marcar(c: PoolClient, ag: string, status: string) {
  await c.query("update agendamentos set status = $2 where id = $1", [ag, status]);
}

beforeAll(async () => {
  await resetarBanco();
  const d = await criarUsuario("dona");
  dona = d.uid;
  donaId = d.colaboradorId;
  const r = await criarUsuario("recepcao");
  recepcao = r.uid;
  recepcaoId = r.colaboradorId;
  const a = await criarUsuario("profissional");
  profA = a.uid;
  profAId = a.colaboradorId;
  profB = (await criarUsuario("profissional")).uid;

  await comoSuperusuario(async (c) => {
    const cliente = async (nome: string) =>
      (
        await c.query<{ id: string }>(
          "insert into clientes (nome, aceite_lgpd_em) values ($1, now()) returning id",
          [nome],
        )
      ).rows[0].id;
    cli = await cliente("Cliente");
    outraCli = await cliente("Outra");
    const cat = await c.query<{ id: string }>(
      "insert into categorias_servico (nome) values ('Facial') returning id",
    );
    const serv = async (nome: string) =>
      (
        await c.query<{ id: string }>(
          `insert into servicos (nome, categoria_id, duracao_min, preco_centavos)
           values ($1, $2, 30, 10000) returning id`,
          [nome, cat.rows[0].id],
        )
      ).rows[0].id;
    servico = await serv("Peeling");
    outroServico = await serv("Limpeza");
    // Vínculo da profissional A com a cliente.
    await agendar(c, { status: "confirmado" });
  });
});

afterAll(fecharConexoes);

describe("estrutura", () => {
  it("unicidade, checks e FK de agendamentos", async () => {
    const r = await comoSuperusuario((c) =>
      linhas(
        c,
        `select conname from pg_constraint
         where conname in ('cobrancas_agendamento_unico', 'cobrancas_pacote_unico',
                           'agendamentos_pacote_vendido_id_fkey')
         order by conname`,
      ),
    );
    expect(r.map((l) => l.conname)).toEqual([
      "agendamentos_pacote_vendido_id_fkey",
      "cobrancas_agendamento_unico",
      "cobrancas_pacote_unico",
    ]);
  });

  it("enum status_pacote", async () => {
    const r = await comoSuperusuario((c) =>
      linhas(c, "select enum_range(null::status_pacote)::text[] as v"),
    );
    expect(r[0].v).toEqual(["ativo", "concluido", "expirado", "cancelado"]);
  });

  it("validar_parte_pagamento é interna (sem execute para authenticated)", async () => {
    const r = await comoSuperusuario((c) =>
      linhas(
        c,
        `select p.proname, has_function_privilege('authenticated', p.oid, 'execute') as auth,
                has_function_privilege('anon', p.oid, 'execute') as anon, p.prosecdef as definer
         from pg_proc p
         where p.pronamespace = 'public'::regnamespace
           and p.proname in ('validar_parte_pagamento', 'registrar_cobranca', 'vender_pacote',
                             'cancelar_pacote', 'expirar_pacotes')
         order by p.proname`,
      ),
    );
    expect(r).toEqual([
      { proname: "cancelar_pacote", auth: true, anon: false, definer: true },
      { proname: "expirar_pacotes", auth: true, anon: false, definer: true },
      { proname: "registrar_cobranca", auth: true, anon: false, definer: true },
      { proname: "validar_parte_pagamento", auth: false, anon: false, definer: false },
      { proname: "vender_pacote", auth: true, anon: false, definer: true },
    ]);
  });
});

describe("registrar_cobranca", () => {
  it("cobrança dividida: uma linha de pagamento por parte, fechar_caixa não muda", async () => {
    await comoUsuario(recepcao, async (c) => {
      const caixa = (await c.query<{ id: string }>("select abrir_caixa(5000) as id")).rows[0].id;
      await comoSuper(c);
      const ag = await agendar(c);
      await logarComo(c, recepcao);
      const id = await cobrar(
        c,
        "agendamento",
        ag,
        null,
        1000,
        partes(pix(6000), { forma: "dinheiro", valor_centavos: 3000, parcelas: 1 }),
      );
      expect(
        await linhas(
          c,
          "select forma, valor_centavos, desconto_centavos from pagamentos where cobranca_id = $1 order by forma",
          [id],
        ),
      ).toEqual([
        { forma: "pix", valor_centavos: 6000, desconto_centavos: 0 },
        { forma: "dinheiro", valor_centavos: 3000, desconto_centavos: 0 },
      ]);
      expect(
        await linhas(
          c,
          `select origem::text as origem, agendamento_id, cliente_id, valor_bruto_centavos,
                  desconto_centavos, caixa_id, lancada_por
           from cobrancas where id = $1`,
          [id],
        ),
      ).toEqual([
        {
          origem: "agendamento",
          agendamento_id: ag,
          cliente_id: cli,
          valor_bruto_centavos: 10000,
          desconto_centavos: 1000,
          caixa_id: caixa,
          lancada_por: recepcaoId,
        },
      ]);
      expect(
        await linhas(
          c,
          "select distinct origem::text as origem, agendamento_id from pagamentos where cobranca_id = $1",
          [id],
        ),
      ).toEqual([{ origem: "agendamento", agendamento_id: ag }]);

      // Leitura: recepção vê as cobranças do caixa aberto; profissional nunca.
      expect(await contar(c, "cobrancas")).toBe(1);
      await logarComo(c, profA);
      expect(await contar(c, "cobrancas")).toBe(0);
      await logarComo(c, recepcao);

      const f = (
        await c.query<{ f: { total_geral: number; dinheiro_esperado: number; diferenca: number } }>(
          "select fechar_caixa($1, 8000) as f",
          [caixa],
        )
      ).rows[0].f;
      expect(f.total_geral).toBe(9000);
      expect(f.dinheiro_esperado).toBe(8000);
      expect(f.diferenca).toBe(0);

      expect(await contar(c, "cobrancas")).toBe(0);
      await logarComo(c, dona);
      expect(await contar(c, "cobrancas")).toBe(1);
    });
  });

  it.each([
    [
      "soma diferente do total com desconto",
      () => partes(pix(6000), { forma: "dinheiro", valor_centavos: 3000, parcelas: 1 }),
      "A soma das formas de pagamento deve ser igual ao total com desconto.",
    ],
    [
      "5 partes",
      () => partes(...Array(5).fill(pix(2000))),
      "Informe de 1 a 4 formas de pagamento.",
    ],
    ["nenhuma parte", () => "[]", "Informe de 1 a 4 formas de pagamento."],
    [
      "forma desconhecida",
      () => partes({ forma: "cheque", valor_centavos: 10000, parcelas: 1 }),
      "Forma de pagamento inválida",
    ],
    [
      "vencimento que não é data",
      () =>
        partes({
          forma: "a_receber",
          valor_centavos: 10000,
          parcelas: 1,
          vencimentos: ["amanhã"],
          valores_parcelas: [10000],
        }),
      "Forma de pagamento inválida",
    ],
    ["não é lista", () => '{"forma": "pix"}', "Informe de 1 a 4 formas de pagamento."],
    [
      "parte com valor zero",
      () => partes(pix(10000), { forma: "dinheiro", valor_centavos: 0, parcelas: 1 }),
      "Cada forma de pagamento deve ter valor maior que zero.",
    ],
    [
      "pix parcelado",
      () => partes({ forma: "pix", valor_centavos: 10000, parcelas: 2 }),
      "Só crédito parcelado ou a receber podem ter mais de uma parcela",
    ],
    [
      "a receber sem vencimentos",
      () => partes({ forma: "a_receber", valor_centavos: 10000, parcelas: 2 }),
      "Informe um vencimento e um valor para cada parcela",
    ],
    [
      "a receber com parcelas que não somam a parte",
      () =>
        partes({
          forma: "a_receber",
          valor_centavos: 10000,
          parcelas: 2,
          vencimentos: ["2030-12-03", "2031-01-03"],
          valores_parcelas: [5000, 4000],
        }),
      "A soma das parcelas deve ser igual ao valor com desconto",
    ],
  ])("%s → P0001", async (_n, p, mensagem) => {
    await comoUsuario(recepcao, async (c) => {
      await c.query("select abrir_caixa(0)");
      await comoSuper(c);
      const ag = await agendar(c);
      await logarComo(c, recepcao);
      const e = await esperarErroSql(c.query(COBRAR, ["agendamento", ag, null, 0, p()]), "P0001");
      expect(e.message).toBe(mensagem);
    });
  });

  it("desconto fora de 0..bruto → P0001", async () => {
    await comoUsuario(recepcao, async (c) => {
      await c.query("select abrir_caixa(0)");
      await comoSuper(c);
      const ag = await agendar(c);
      await logarComo(c, recepcao);
      await falha(c, COBRAR, ["agendamento", ag, null, -1, partes(pix(10001))]);
      await falha(c, COBRAR, ["agendamento", ag, null, 10001, partes(pix(1))]);
    });
  });

  it("parte a receber gera as contas a receber ligadas à linha da parte", async () => {
    await comoUsuario(recepcao, async (c) => {
      await c.query("select abrir_caixa(0)");
      await comoSuper(c);
      const ag2 = await agendar(c);
      await logarComo(c, recepcao);
      const id = await cobrar(
        c,
        "agendamento",
        ag2,
        null,
        0,
        partes(pix(7000), {
          forma: "a_receber",
          valor_centavos: 3000,
          parcelas: 3,
          vencimentos: ["2030-12-03", "2031-01-03", "2031-02-03"],
          valores_parcelas: [1000, 1000, 1000],
        }),
      );
      await logarComo(c, dona);
      const parte = (
        await c.query<{ id: string; parcelas: number }>(
          "select id, parcelas from pagamentos where cobranca_id = $1 and forma = 'a_receber'",
          [id],
        )
      ).rows[0];
      expect(parte.parcelas).toBe(3);
      expect(
        await linhas(
          c,
          `select pagamento_id, numero, total_parcelas, valor_centavos,
                  to_char(vencimento, 'YYYY-MM-DD') as vencimento
           from contas_receber where cliente_id = $1 order by numero`,
          [cli],
        ),
      ).toEqual([
        { pagamento_id: parte.id, numero: 1, total_parcelas: 3, valor_centavos: 1000, vencimento: "2030-12-03" },
        { pagamento_id: parte.id, numero: 2, total_parcelas: 3, valor_centavos: 1000, vencimento: "2031-01-03" },
        { pagamento_id: parte.id, numero: 3, total_parcelas: 3, valor_centavos: 1000, vencimento: "2031-02-03" },
      ]);
    });
  });

  it("segunda cobrança do mesmo atendimento: 23505 cobrancas_agendamento_unico", async () => {
    await comoUsuario(recepcao, async (c) => {
      await c.query("select abrir_caixa(0)");
      await comoSuper(c);
      const ag = await agendar(c);
      await logarComo(c, recepcao);
      await cobrar(c, "agendamento", ag, null, 0, partes(pix(10000)));
      const e = await esperarErroSql(
        cobrar(c, "agendamento", ag, null, 0, partes(pix(10000))),
        "23505",
      );
      expect(e.message).toContain("cobrancas_agendamento_unico");
    });
  });

  it("regras do atendimento, da origem, do caixa e do perfil", async () => {
    await comoUsuario(recepcao, async (c) => {
      await comoSuper(c);
      const confirmado = await agendar(c, { status: "confirmado" });
      const p = await criarPacote(c, { clienteId: cli, servicoId: servico });
      const dePacote = await agendar(c, { pacote: p });
      const ag = await agendar(c);
      await logarComo(c, recepcao);

      // Caixa fechado (não aberto) primeiro.
      expect((await falha(c, COBRAR, ["agendamento", ag, null, 0, partes(pix(10000))])).message).toBe(
        "Abra o caixa do dia antes de lançar pagamentos",
      );
      await c.query("select abrir_caixa(0)");

      expect(
        (await falha(c, COBRAR, ["agendamento", confirmado, null, 0, partes(pix(10000))])).message,
      ).toBe("Só é possível lançar pagamento de atendimento concluído.");
      expect(
        (await falha(c, COBRAR, ["agendamento", dePacote, null, 0, partes(pix(10000))])).message,
      ).toBe("Sessão de pacote: já paga na venda do pacote.");
      expect(
        (await falha(c, COBRAR, ["venda_produto", null, null, 0, partes(pix(10000))])).message,
      ).toBe("Origem de cobrança inválida");

      await logarComo(c, profA);
      expect((await falha(c, COBRAR, ["agendamento", ag, null, 0, partes(pix(10000))])).message).toBe(
        "Apenas a dona ou a recepção podem lançar pagamentos",
      );
    });
  });

  it("anônimo não executa (42501)", async () => {
    await comoUsuario(null, (c) =>
      esperarErroSql(c.query(COBRAR, ["agendamento", null, null, 0, "[]"]), "42501"),
    );
  });
});

describe("registrar_pagamento (atalho de uma parte)", () => {
  it("devolve o id do pagamento e cria a cobrança com bruto e desconto", async () => {
    await comoUsuario(recepcao, async (c) => {
      const caixa = (await c.query<{ id: string }>("select abrir_caixa(0) as id")).rows[0].id;
      await comoSuper(c);
      const ag = await agendar(c, { valor: 12000 });
      await logarComo(c, recepcao);
      const pag = (
        await c.query<{ id: string }>(
          "select registrar_pagamento($1, $2, 'pix', 12000, 1500, 1, null, null) as id",
          [cli, ag],
        )
      ).rows[0].id;
      const r = await linhas(
        c,
        `select p.valor_centavos, p.desconto_centavos, c.valor_bruto_centavos,
                c.desconto_centavos as desconto_cobranca, c.origem::text as origem,
                c.agendamento_id
         from pagamentos p join cobrancas c on c.id = p.cobranca_id where p.id = $1`,
        [pag],
      );
      expect(r).toEqual([
        {
          valor_centavos: 12000,
          desconto_centavos: 1500,
          valor_bruto_centavos: 12000,
          desconto_cobranca: 1500,
          origem: "agendamento",
          agendamento_id: ag,
        },
      ]);
      // venda de produto e cortesia continuam aceitas
      const venda = (
        await c.query<{ id: string }>(
          "select registrar_pagamento($1, null, 'dinheiro', 3000, 3000, 1, null, null) as id",
          [cli],
        )
      ).rows[0].id;
      expect(
        await linhas(
          c,
          `select c.origem::text as origem, c.valor_bruto_centavos, c.desconto_centavos
           from pagamentos p join cobrancas c on c.id = p.cobranca_id where p.id = $1`,
          [venda],
        ),
      ).toEqual([{ origem: "venda_produto", valor_bruto_centavos: 3000, desconto_centavos: 3000 }]);

      // segundo pagamento do mesmo atendimento
      const e = await falha(
        c,
        "select registrar_pagamento($1, $2, 'pix', 12000, 0, 1, null, null)",
        [cli, ag],
        "23505",
      );
      expect(e.message).toContain("cobrancas_agendamento_unico");

      // atendimento de pacote
      await comoSuper(c);
      const p = await criarPacote(c, { clienteId: cli, servicoId: servico });
      const dePacote = await agendar(c, { pacote: p });
      await logarComo(c, recepcao);
      expect(
        (
          await falha(c, "select registrar_pagamento($1, $2, 'pix', 100, 0, 1, null, null)", [
            cli,
            dePacote,
          ])
        ).message,
      ).toBe("Sessão de pacote: já paga na venda do pacote.");

      const f = (
        await c.query<{ f: { total_geral: number } }>("select fechar_caixa($1, 0) as f", [caixa])
      ).rows[0].f;
      expect(f.total_geral).toBe(10500);
    });
  });

  it("agendamentos_sem_pagamento(hoje) não traz atendimento que já tem cobrança", async () => {
    await comoUsuario(recepcao, async (c) => {
      await c.query("select abrir_caixa(0)");
      await comoSuper(c);
      const inicio = (
        await c.query<{ t: string }>(
          `select ((${HOJE})::timestamp + interval '10 hours') at time zone 'America/Sao_Paulo' as t`,
        )
      ).rows[0].t;
      const pago = await agendar(c, { inicio });
      const inicio2 = new Date(new Date(inicio).getTime() + 3_600_000).toISOString();
      const semPagamento = await agendar(c, { inicio: inicio2 });
      await logarComo(c, recepcao);
      await cobrar(c, "agendamento", pago, null, 0, partes(pix(10000)));
      const lista = async (sql: string) => (await linhas(c, sql)).map((l) => l.id);
      expect(await lista(`select id from agendamentos_sem_pagamento(${HOJE}) as id`)).toEqual([
        semPagamento,
      ]);
      expect(
        await lista(`select id from agendamentos_sem_pagamento_periodo(${HOJE}, ${HOJE}) as id`),
      ).toEqual([semPagamento]);
    });
  });
});

describe("vender_pacote", () => {
  it("cria pacote ativo e cobrança de origem pacote; erro desfaz tudo", async () => {
    await comoUsuario(recepcao, async (c) => {
      await c.query("select abrir_caixa(0)");
      const p = (
        await c.query<{ id: string }>(VENDER, [cli, servico, 2, 50000, null, 0, partes(pix(50000))])
      ).rows[0].id;
      expect(
        await linhas(
          c,
          `select total_sessoes, sessoes_usadas, valor_total_centavos, validade,
                  status::text as status, vendido_por
           from pacotes_vendidos where id = $1`,
          [p],
        ),
      ).toEqual([
        {
          total_sessoes: 2,
          sessoes_usadas: 0,
          valor_total_centavos: 50000,
          validade: null,
          status: "ativo",
          vendido_por: recepcaoId,
        },
      ]);
      expect(
        await linhas(
          c,
          `select origem::text as origem, pacote_vendido_id, agendamento_id, valor_bruto_centavos
           from cobrancas where pacote_vendido_id = $1`,
          [p],
        ),
      ).toEqual([
        { origem: "pacote", pacote_vendido_id: p, agendamento_id: null, valor_bruto_centavos: 50000 },
      ]);
      expect(
        await linhas(c, "select origem::text as origem from pagamentos where cobranca_id = (select id from cobrancas where pacote_vendido_id = $1)", [p]),
      ).toEqual([{ origem: "pacote" }]);

      // Pacote já cobrado: segunda cobrança falha pela unicidade.
      const dup = await falha(c, COBRAR, ["pacote", null, p, 0, partes(pix(50000))], "23505");
      expect(dup.message).toContain("cobrancas_pacote_unico");

      const antes = await contar(c, "pacotes_vendidos");
      const e = await falha(c, VENDER, [cli, servico, 2, 50000, null, 0, partes(pix(40000))]);
      expect(e.message).toBe("A soma das formas de pagamento deve ser igual ao total com desconto.");
      expect(await contar(c, "pacotes_vendidos")).toBe(antes);

      expect(
        (await falha(c, VENDER, [cli, servico, 51, 50000, null, 0, partes(pix(50000))])).message,
      ).toBe("O pacote deve ter de 1 a 50 sessões.");
      expect(
        (await falha(c, VENDER, [cli, servico, 0, 50000, null, 0, partes(pix(50000))])).message,
      ).toBe("O pacote deve ter de 1 a 50 sessões.");
      const ontem = (await linhas(c, `select (${HOJE} - 1)::text as d`))[0].d;
      expect(
        (await falha(c, VENDER, [cli, servico, 2, 50000, ontem, 0, partes(pix(50000))])).message,
      ).toBe("A validade não pode ser anterior a hoje.");
      const hoje = (await linhas(c, `select (${HOJE})::text as d`))[0].d;
      await c.query(VENDER, [cli, servico, 2, 50000, hoje, 0, partes(pix(50000))]);

      await logarComo(c, profA);
      expect(
        (await falha(c, VENDER, [cli, servico, 2, 50000, null, 0, partes(pix(50000))])).message,
      ).toBe("Apenas a dona ou a recepção podem vender pacotes");
    });
  });

  it("serviço inativo é recusado", async () => {
    await comoUsuario(dona, async (c) => {
      await c.query("select abrir_caixa(0)");
      await comoSuper(c);
      await c.query("update servicos set ativo = false where id = $1", [outroServico]);
      await logarComo(c, dona);
      await falha(c, VENDER, [cli, outroServico, 2, 50000, null, 0, partes(pix(50000))]);
    });
  });
});

describe("consumo de sessões", () => {
  it("atendido consome, falta não, esgota, reversão devolve", async () => {
    await comoUsuario(profA, async (c) => {
      await comoSuper(c);
      const p = await criarPacote(c, { clienteId: cli, servicoId: servico, total: 2 });
      const [a1, a2, a3, a4] = [
        await agendar(c, { status: "confirmado", pacote: p }),
        await agendar(c, { status: "confirmado", pacote: p }),
        await agendar(c, { status: "confirmado", pacote: p }),
        await agendar(c, { status: "confirmado", pacote: p }),
      ];
      await logarComo(c, profA);
      await marcar(c, a1, "atendido");
      expect(await pacote(c, p)).toMatchObject({ sessoes_usadas: 1, status: "ativo" });
      await marcar(c, a2, "faltou");
      expect(await pacote(c, p)).toMatchObject({ sessoes_usadas: 1, status: "ativo" });
      await marcar(c, a3, "atendido");
      expect(await pacote(c, p)).toMatchObject({ sessoes_usadas: 2, status: "concluido" });
      const e = await falha(c, "update agendamentos set status = 'atendido' where id = $1", [a4]);
      expect(e.message).toBe(MSG_ESGOTADO);

      await logarComo(c, dona);
      await marcar(c, a3, "confirmado");
      expect(await pacote(c, p)).toMatchObject({ sessoes_usadas: 1, status: "ativo" });
      // atualizar o status sem mudar não consome de novo
      await marcar(c, a1, "atendido");
      expect(await pacote(c, p)).toMatchObject({ sessoes_usadas: 1 });
      // cancelar um atendido também devolve
      await marcar(c, a1, "cancelado");
      expect(await pacote(c, p)).toMatchObject({ sessoes_usadas: 0, status: "ativo" });
    });
  });

  it("inserir já atendido consome", async () => {
    await comoSuperusuario(async (c) => {
      await c.query("savepoint s");
      const p = await criarPacote(c, { clienteId: cli, servicoId: servico, total: 1 });
      await agendar(c, { pacote: p });
      expect(await pacote(c, p)).toMatchObject({ sessoes_usadas: 1, status: "concluido" });
      await c.query("rollback to savepoint s");
    });
  });

  it("reversão de concluído vencido volta como expirado; cancelado fica cancelado", async () => {
    await comoUsuario(dona, async (c) => {
      await comoSuper(c);
      const ontem = (await linhas(c, `select (${HOJE} - 1)::text as d`))[0].d;
      const p = await criarPacote(c, { clienteId: cli, servicoId: servico, total: 1 });
      const a = await agendar(c, { pacote: p });
      await c.query("update pacotes_vendidos set validade = $2 where id = $1", [p, ontem]);
      const q = await criarPacote(c, { clienteId: cli, servicoId: servico, total: 2 });
      const b = await agendar(c, { pacote: q });
      await c.query("update pacotes_vendidos set status = 'cancelado' where id = $1", [q]);
      await logarComo(c, dona);
      await marcar(c, a, "confirmado");
      expect(await pacote(c, p)).toMatchObject({ sessoes_usadas: 0, status: "expirado" });
      await marcar(c, b, "confirmado");
      expect(await pacote(c, q)).toMatchObject({ sessoes_usadas: 0, status: "cancelado" });
    });
  });

  it("pacote vencido, de outra cliente/serviço, troca em atendido", async () => {
    await comoUsuario(profA, async (c) => {
      await comoSuper(c);
      const r = await linhas(
        c,
        `select (${HOJE} - 1)::text as d, to_char(${HOJE} - 1, 'DD/MM/YYYY') as br`,
      );
      const vencido = await criarPacote(c, { clienteId: cli, servicoId: servico, validade: r[0].d });
      const ag = await agendar(c, { status: "confirmado", pacote: vencido });
      const p = await criarPacote(c, { clienteId: cli, servicoId: servico });
      const q = await criarPacote(c, { clienteId: cli, servicoId: servico });
      const concluido = await criarPacote(c, {
        clienteId: cli,
        servicoId: servico,
        status: "concluido",
      });

      const msgOutra = "O pacote não é desta cliente ou deste serviço.";
      for (const [cliente, serv] of [
        [outraCli, servico],
        [cli, outroServico],
      ]) {
        await c.query("savepoint s");
        const e = await esperarErroSql(agendar(c, { cliente, servico: serv, pacote: p }), "P0001");
        expect(e.message).toBe(msgOutra);
        await c.query("rollback to savepoint s");
      }
      await c.query("savepoint s");
      expect(
        (await esperarErroSql(agendar(c, { status: "confirmado", pacote: concluido }), "P0001"))
          .message,
      ).toBe(MSG_NAO_ATIVO);
      await c.query("rollback to savepoint s");

      const atendido = await agendar(c, { pacote: p });
      const semPacote = await agendar(c, { status: "confirmado" });
      expect(
        (await falha(c, "update agendamentos set pacote_vendido_id = $2 where id = $1", [atendido, q]))
          .message,
      ).toBe("Não é possível trocar o pacote de um atendimento concluído.");
      expect(
        (await falha(c, "update agendamentos set cliente_id = $2 where id = $1", [atendido, outraCli]))
          .message,
      ).toBe(msgOutra);
      await c.query("update agendamentos set pacote_vendido_id = $2 where id = $1", [semPacote, q]);

      await logarComo(c, profA);
      const e = await falha(c, "update agendamentos set status = 'atendido' where id = $1", [ag]);
      expect(e.message).toBe(`Este pacote venceu em ${r[0].br}.`);
    });
  });

  it("validade hoje ainda vale", async () => {
    await comoUsuario(profA, async (c) => {
      await comoSuper(c);
      const hoje = (await linhas(c, `select (${HOJE})::text as d`))[0].d;
      const p = await criarPacote(c, { clienteId: cli, servicoId: servico, validade: hoje });
      const ag = await agendar(c, { status: "confirmado", pacote: p });
      await logarComo(c, profA);
      await marcar(c, ag, "atendido");
      expect(await pacote(c, p)).toMatchObject({ sessoes_usadas: 1 });
    });
  });
});

describe("cancelar_pacote e expirar_pacotes", () => {
  it("só a dona cancela, só ativo; depois não consome", async () => {
    await comoUsuario(recepcao, async (c) => {
      await comoSuper(c);
      const p = await criarPacote(c, { clienteId: cli, servicoId: servico });
      const ag = await agendar(c, { status: "confirmado", pacote: p });
      await logarComo(c, recepcao);
      expect((await falha(c, "select cancelar_pacote($1)", [p])).message).toBe(
        "Apenas a dona pode cancelar pacotes",
      );
      await logarComo(c, dona);
      await c.query("select cancelar_pacote($1)", [p]);
      expect(
        await linhas(
          c,
          "select status::text as status, cancelado_por, cancelado_em is not null as em from pacotes_vendidos where id = $1",
          [p],
        ),
      ).toEqual([{ status: "cancelado", cancelado_por: donaId, em: true }]);
      expect((await falha(c, "select cancelar_pacote($1)", [p])).message).toBe(
        "Só pacotes ativos podem ser cancelados.",
      );
      expect((await falha(c, "update agendamentos set status = 'atendido' where id = $1", [ag])).message).toBe(
        MSG_NAO_ATIVO,
      );
    });
  });

  it("expirar_pacotes: ativo vencido com sessões → expirado; concluído fica", async () => {
    await comoUsuario(profA, async (c) => {
      await comoSuper(c);
      const ontem = (await linhas(c, `select (${HOJE} - 1)::text as d`))[0].d;
      const vencido = await criarPacote(c, { clienteId: cli, servicoId: servico, validade: ontem });
      const concluido = await criarPacote(c, {
        clienteId: cli,
        servicoId: servico,
        validade: ontem,
        status: "concluido",
      });
      const emDia = await criarPacote(c, { clienteId: cli, servicoId: servico });
      const esperados = (
        await linhas(
          c,
          `select count(*)::int as n from pacotes_vendidos
           where status = 'ativo' and validade < ${HOJE} and sessoes_usadas < total_sessoes`,
        )
      )[0].n;
      await logarComo(c, profA);
      const n = (await linhas(c, "select expirar_pacotes() as n"))[0].n;
      expect(n).toBe(esperados);
      expect(n).toBeGreaterThanOrEqual(1);
      expect(await pacote(c, vencido)).toMatchObject({ status: "expirado" });
      expect(await pacote(c, concluido)).toMatchObject({ status: "concluido" });
      expect(await pacote(c, emDia)).toMatchObject({ status: "ativo" });
      expect((await linhas(c, "select expirar_pacotes() as n"))[0].n).toBe(0);
    });
  });
});

describe("RLS e privilégios de pacotes_vendidos e cobrancas", () => {
  it("leitura por perfil e vínculo", async () => {
    await comoUsuario(profB, async (c) => {
      await comoSuper(c);
      await criarPacote(c, { clienteId: cli, servicoId: servico });
      await criarPacote(c, { clienteId: outraCli, servicoId: servico });
      const total = await contar(c, "pacotes_vendidos");
      const deCli = (
        await linhas(c, "select count(*)::int as n from pacotes_vendidos where cliente_id = $1", [cli])
      )[0].n;
      await logarComo(c, profB);
      expect(await contar(c, "pacotes_vendidos")).toBe(0);
      await logarComo(c, profA);
      expect(await contar(c, "pacotes_vendidos")).toBe(deCli);
      await logarComo(c, recepcao);
      expect(await contar(c, "pacotes_vendidos")).toBe(total);
      await logarComo(c, dona);
      expect(await contar(c, "pacotes_vendidos")).toBe(total);
    });
  });

  it.each([
    [
      "insert em pacotes_vendidos",
      "insert into pacotes_vendidos (cliente_id, servico_id, total_sessoes, valor_total_centavos) values ($1, $2, 1, 100)",
      () => [cli, servico],
    ],
    [
      "insert em cobrancas",
      `insert into cobrancas (origem, cliente_id, valor_bruto_centavos, caixa_id, lancada_por)
       values ('venda_produto', $1, 100, gen_random_uuid(), $2)`,
      () => [cli, recepcaoId],
    ],
    ["update em pacotes_vendidos", "update pacotes_vendidos set sessoes_usadas = 0", () => []],
    ["update em cobrancas", "update cobrancas set desconto_centavos = 0", () => []],
    ["delete em pacotes_vendidos", "delete from pacotes_vendidos", () => []],
    ["delete em cobrancas", "delete from cobrancas", () => []],
  ])("%s → 42501 (dona)", async (_n, sql, params) => {
    await comoUsuario(dona, (c) => esperarErroSql(c.query(sql, params()), "42501"));
  });

  it("anônimo não lê (42501)", async () => {
    await comoUsuario(null, (c) =>
      esperarErroSql(c.query("select * from pacotes_vendidos"), "42501"),
    );
    await comoUsuario(null, (c) => esperarErroSql(c.query("select * from cobrancas"), "42501"));
  });
});

describe("concorrência: última sessão em dois atendimentos ao mesmo tempo", () => {
  it("só um consome; o outro recebe 'Todas as sessões do pacote já foram usadas.'", async () => {
    const { p, a1, a2 } = await comoSuperusuario(async (c) => {
      const p = await criarPacote(c, { clienteId: cli, servicoId: servico, total: 2 });
      await agendar(c, { pacote: p }); // 1 sessão usada, 1 restante
      const a1 = await agendar(c, { status: "confirmado", pacote: p });
      const a2 = await agendar(c, { status: "confirmado", pacote: p });
      return { p, a1, a2 };
    });

    const c1 = await abrirConexao(profA);
    const c2 = await abrirConexao(profA);
    try {
      await c1.query("begin");
      await c1.query("update agendamentos set status = 'atendido' where id = $1", [a1]);
      await c2.query("begin");
      const pid2 = (await c2.query<{ pid: number }>("select pg_backend_pid() as pid")).rows[0].pid;
      const segundo = c2
        .query("update agendamentos set status = 'atendido' where id = $1", [a2])
        .then(
          () => null,
          (e: unknown) => e as { code?: string; message: string },
        );

      // Espera c2 ficar bloqueada no lock do pacote.
      let esperando = false;
      for (let i = 0; i < 100 && !esperando; i++) {
        esperando = await comoSuperusuario(async (c) => {
          const r = await c.query<{ w: string | null }>(
            "select wait_event_type as w from pg_stat_activity where pid = $1",
            [pid2],
          );
          return r.rows[0]?.w === "Lock";
        });
        if (!esperando) await new Promise((r) => setTimeout(r, 20));
      }
      expect(esperando).toBe(true);

      await c1.query("commit");
      const erro = await segundo;
      expect(erro?.code).toBe("P0001");
      expect(erro?.message).toBe(MSG_ESGOTADO);
      await c2.query("rollback");
    } finally {
      c1.release();
      c2.release();
    }

    const final = await comoSuperusuario((c) => pacote(c, p));
    expect(final).toEqual({ sessoes_usadas: 2, status: "concluido" });
  });
});

describe("migração dos pagamentos da Fase 1 (0006 → 0007)", () => {
  it("cada pagamento vira uma cobrança com o mesmo id; caixa não muda", async () => {
    await resetarBanco({ ate: "0006" });
    const rec = await criarUsuario("recepcao");
    const prof = await criarUsuario("profissional");
    const ids = await comoSuperusuario(async (c) => {
      const tabela = await c.query("select to_regclass('public.cobrancas') as t");
      expect(tabela.rows[0].t).toBeNull();
      const cliente = (
        await c.query<{ id: string }>(
          "insert into clientes (nome, aceite_lgpd_em) values ('Antiga', now()) returning id",
        )
      ).rows[0].id;
      const cat = await c.query<{ id: string }>(
        "insert into categorias_servico (nome) values ('Facial') returning id",
      );
      const serv = (
        await c.query<{ id: string }>(
          `insert into servicos (nome, categoria_id, duracao_min, preco_centavos)
           values ('Peeling', $1, 30, 12000) returning id`,
          [cat.rows[0].id],
        )
      ).rows[0].id;
      const ag = (
        await c.query<{ id: string }>(
          `insert into agendamentos (cliente_id, profissional_id, servico_id, inicio, fim, status)
           values ($1, $2, $3, '2030-01-01T10:00:00Z', '2030-01-01T10:30:00Z', 'atendido') returning id`,
          [cliente, prof.colaboradorId, serv],
        )
      ).rows[0].id;
      const caixa = (
        await c.query<{ id: string }>(
          `insert into caixas (data, aberto_por, valor_inicial_centavos)
           values (${HOJE}, $1, 0) returning id`,
          [rec.colaboradorId],
        )
      ).rows[0].id;
      const pag = await c.query<{ id: string }>(
        `insert into pagamentos (caixa_id, cliente_id, origem, agendamento_id, forma,
           valor_centavos, desconto_centavos, lancado_por)
         values ($1, $2, 'agendamento', $3, 'pix', 12000, 1500, $4),
                ($1, $2, 'venda_produto', null, 'dinheiro', 3000, 0, $4)
         returning id`,
        [caixa, cliente, ag, rec.colaboradorId],
      );
      return { caixa, cliente, ag, pagamentos: pag.rows.map((l) => l.id) };
    });

    await aplicarMigracoes("0007");

    await comoSuperusuario(async (c) => {
      expect(await contar(c, "cobrancas")).toBe(2);
      const r = await linhas(
        c,
        `select p.id = p.cobranca_id as mesmo_id, c.origem::text as origem, c.agendamento_id,
                c.pacote_vendido_id, c.cliente_id, c.valor_bruto_centavos, c.desconto_centavos,
                c.caixa_id, c.lancada_por, c.lancada_em = p.criado_em as mesma_data
         from pagamentos p join cobrancas c on c.id = p.cobranca_id
         order by c.valor_bruto_centavos desc`,
      );
      const base = {
        mesmo_id: true,
        pacote_vendido_id: null,
        cliente_id: ids.cliente,
        caixa_id: ids.caixa,
        lancada_por: rec.colaboradorId,
        mesma_data: true,
      };
      expect(r).toEqual([
        { ...base, origem: "agendamento", agendamento_id: ids.ag, valor_bruto_centavos: 12000, desconto_centavos: 1500 },
        { ...base, origem: "venda_produto", agendamento_id: null, valor_bruto_centavos: 3000, desconto_centavos: 0 },
      ]);
      const nulo = await linhas(
        c,
        `select is_nullable from information_schema.columns
         where table_schema = 'public' and table_name = 'pagamentos' and column_name = 'cobranca_id'`,
      );
      expect(nulo).toEqual([{ is_nullable: "NO" }]);
    });

    const f = await comoUsuario(rec.uid, async (c) =>
      (await c.query<{ f: { total_geral: number } }>("select fechar_caixa($1, 3000) as f", [ids.caixa]))
        .rows[0].f,
    );
    expect(f.total_geral).toBe(13500);
  });
});
