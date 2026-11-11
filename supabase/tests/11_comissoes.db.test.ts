import type { PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  comoSuperusuario,
  comoUsuario,
  contar,
  criarPacote,
  criarUsuario,
  esperarErroSql,
  fecharConexoes,
  inserirPagamentoDireto,
  resetarBanco,
} from "./helpers";

// 0011 (seções 1–2): percentuais de comissão, comissão automática pelo status
// do agendamento, recálculo pela cobrança, pagar_comissoes e resumo_comissoes.

const MSG_PAGA = "A comissão deste atendimento já foi paga.";
const MSG_SEM_ABERTAS = "Não há comissões em aberto.";
const MSG_DONA = "Apenas a dona pode lançar contas.";
const PAGAR = "select pagar_comissoes($1, $2, $3, $4) as id";

let dona: string;
let donaId: string;
let recepcao: string;
let prof: string;
let profId: string;
let prof2Id: string;
let cli: string;
let servico: string;
let servicoSemPct: string;
let caixa: string;

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

let hora = 0;
/** Superusuário: agendamento (horários sem sobreposição em 2026-11). */
async function agendar(
  c: PoolClient,
  p: {
    status?: string;
    profissional?: string;
    servico?: string;
    valor?: number;
    pacote?: string | null;
    inicio?: string;
  } = {},
): Promise<string> {
  hora += 1;
  const inicio = p.inicio ?? new Date(Date.UTC(2026, 10, 2, hora)).toISOString();
  const r = await c.query<{ id: string }>(
    `insert into agendamentos (cliente_id, profissional_id, servico_id, inicio, fim,
       status, pacote_vendido_id, valor_previsto_centavos)
     values ($1, $2, $3, $4::timestamptz, $4::timestamptz + interval '30 minutes', $5, $6, $7)
     returning id`,
    [
      cli,
      p.profissional ?? profId,
      p.servico ?? servico,
      inicio,
      p.status ?? "confirmado",
      p.pacote ?? null,
      p.valor ?? 20000,
    ],
  );
  return r.rows[0].id;
}

async function marcar(c: PoolClient, ag: string, status: string) {
  await c.query("update agendamentos set status = $2 where id = $1", [ag, status]);
}

async function comissoesDe(c: PoolClient, ag: string) {
  return (
    await c.query(
      `select status::text, base_centavos, percentual::float8 as percentual, valor_centavos,
              competencia::text, cancelada_motivo, cancelada_em is not null as tem_cancelada_em,
              conta_pagar_id, pago_em::text, profissional_id
       from comissoes where agendamento_id = $1`,
      [ag],
    )
  ).rows;
}

/** Superusuário: zera e define os percentuais (deixa a sessão como superusuário). */
async function definirPct(c: PoolClient, p: { servico?: number; prof?: number }) {
  await comoSuper(c);
  await c.query("delete from servicos_comissao");
  await c.query("delete from colaboradores_comissao");
  if (p.servico !== undefined) {
    await c.query("insert into servicos_comissao (servico_id, percentual) values ($1, $2)", [
      servico,
      p.servico,
    ]);
  }
  if (p.prof !== undefined) {
    await c.query(
      "insert into colaboradores_comissao (colaborador_id, percentual) values ($1, $2)",
      [profId, p.prof],
    );
  }
}

beforeAll(async () => {
  await resetarBanco();
  ({ uid: dona, colaboradorId: donaId } = await criarUsuario("dona"));
  ({ uid: recepcao } = await criarUsuario("recepcao"));
  ({ uid: prof, colaboradorId: profId } = await criarUsuario("profissional", {
    nome: "Ana Lima",
  }));
  ({ colaboradorId: prof2Id } = await criarUsuario("profissional", { nome: "Bia" }));

  await comoSuperusuario(async (c) => {
    cli = (
      await c.query<{ id: string }>(
        "insert into clientes (nome, aceite_lgpd_em) values ('Cliente', now()) returning id",
      )
    ).rows[0].id;
    const cat = await c.query<{ id: string }>(
      "insert into categorias_servico (nome) values ('Facial') returning id",
    );
    const serv = async (nome: string) =>
      (
        await c.query<{ id: string }>(
          `insert into servicos (nome, categoria_id, duracao_min, preco_centavos)
           values ($1, $2, 30, 20000) returning id`,
          [nome, cat.rows[0].id],
        )
      ).rows[0].id;
    servico = await serv("Peeling");
    servicoSemPct = await serv("Limpeza");
    caixa = (
      await c.query<{ id: string }>(
        `insert into caixas (data, aberto_por, valor_inicial_centavos)
         values ('2026-11-02', $1, 0) returning id`,
        [donaId],
      )
    ).rows[0].id;
  });
});

afterAll(fecharConexoes);

describe("estrutura", () => {
  it("enum status_comissao e funções internas sem execute", async () => {
    const r = await comoSuperusuario(async (c) => {
      const e = await c.query("select enum_range(null::status_comissao)::text[] as v");
      const f = await c.query(
        `select p.proname, has_function_privilege('authenticated', p.oid, 'execute') as auth,
                has_function_privilege('anon', p.oid, 'execute') as anon, p.prosecdef as definer
         from pg_proc p
         where p.pronamespace = 'public'::regnamespace
           and p.proname in ('percentual_comissao', 'base_comissao', 'gravar_comissao',
                             'agendamentos_comissao', 'cobrancas_comissao',
                             'pagar_comissoes', 'resumo_comissoes')
         order by p.proname`,
      );
      return { e: e.rows[0].v, f: f.rows };
    });
    expect(r.e).toEqual(["aberta", "paga", "cancelada"]);
    expect(r.f).toEqual([
      { proname: "agendamentos_comissao", auth: false, anon: false, definer: true },
      { proname: "base_comissao", auth: false, anon: false, definer: true },
      { proname: "cobrancas_comissao", auth: false, anon: false, definer: true },
      { proname: "gravar_comissao", auth: false, anon: false, definer: true },
      { proname: "pagar_comissoes", auth: true, anon: false, definer: true },
      { proname: "percentual_comissao", auth: false, anon: false, definer: true },
      { proname: "resumo_comissoes", auth: true, anon: false, definer: true },
    ]);
  });

  it("percentual fora de 0–100 → 23514", async () => {
    await comoUsuario(dona, async (c) => {
      await falha(
        c,
        "insert into servicos_comissao (servico_id, percentual) values ($1, 100.01)",
        [servico],
        "23514",
      );
      await falha(
        c,
        "insert into colaboradores_comissao (colaborador_id, percentual) values ($1, -1)",
        [profId],
        "23514",
      );
    });
  });
});

describe("percentual efetivo", () => {
  it("serviço 30% + profissional 10% → 30%; sem % do serviço → 10%; nenhum → 0", async () => {
    await comoUsuario(dona, async (c) => {
      await definirPct(c, { servico: 30, prof: 10 });
      await comoSuper(c);
      const a1 = await agendar(c, { status: "atendido" });
      const a2 = await agendar(c, { status: "atendido", servico: servicoSemPct });
      const a3 = await agendar(c, { status: "atendido", profissional: prof2Id });
      expect((await comissoesDe(c, a1))[0]).toMatchObject({ percentual: 30, valor_centavos: 6000 });
      expect((await comissoesDe(c, a2))[0]).toMatchObject({ percentual: 10, valor_centavos: 2000 });
      // prof2 sem % e serviço 30% → 30% (o do serviço sobrepõe).
      expect((await comissoesDe(c, a3))[0]).toMatchObject({ percentual: 30 });
      const a4 = await agendar(c, {
        status: "atendido",
        profissional: prof2Id,
        servico: servicoSemPct,
      });
      expect((await comissoesDe(c, a4))[0]).toMatchObject({
        percentual: 0,
        valor_centavos: 0,
        base_centavos: 20000,
      });
    });
  });
});

describe("base, competência e recálculo", () => {
  it("avulso sem cobrança: base = previsto; competência no mês de SP", async () => {
    await comoUsuario(dona, async (c) => {
      await definirPct(c, { servico: 30 });
      await comoSuper(c);
      const ag = await agendar(c, { inicio: "2026-11-30T23:30:00-03:00" });
      expect(await comissoesDe(c, ag)).toEqual([]);
      await logarComo(c, dona);
      await marcar(c, ag, "atendido");
      expect(await comissoesDe(c, ag)).toEqual([
        expect.objectContaining({
          status: "aberta",
          base_centavos: 20000,
          percentual: 30,
          valor_centavos: 6000,
          competencia: "2026-11-01",
          profissional_id: profId,
        }),
      ]);

      // Cobrança depois: bruto 20000, desconto 5000 → base 15000, valor 4500.
      await comoSuper(c);
      await inserirPagamentoDireto(c, {
        caixaId: caixa,
        clienteId: cli,
        origem: "agendamento",
        agendamentoId: ag,
        forma: "pix",
        valor: 20000,
        desconto: 5000,
        lancadoPor: donaId,
      });
      expect((await comissoesDe(c, ag))[0]).toMatchObject({
        base_centavos: 15000,
        valor_centavos: 4500,
      });
    });
  });

  it("cobrança já existente quando marca atendido: base = bruto − desconto", async () => {
    await comoUsuario(dona, async (c) => {
      await definirPct(c, { servico: 30 });
      await comoSuper(c);
      const ag = await agendar(c);
      await inserirPagamentoDireto(c, {
        caixaId: caixa,
        clienteId: cli,
        origem: "agendamento",
        agendamentoId: ag,
        forma: "pix",
        valor: 10000,
        desconto: 1000,
        lancadoPor: donaId,
      });
      await marcar(c, ag, "atendido");
      expect((await comissoesDe(c, ag))[0]).toMatchObject({
        base_centavos: 9000,
        valor_centavos: 2700,
      });
    });
  });

  it("pacote 100000 em 3 sessões → base 33333; cobrança do pacote não mexe", async () => {
    await comoUsuario(dona, async (c) => {
      await definirPct(c, { servico: 30 });
      await comoSuper(c);
      const pac = await criarPacote(c, { clienteId: cli, servicoId: servico, total: 3 });
      const ag = await agendar(c, { pacote: pac });
      await marcar(c, ag, "atendido");
      expect((await comissoesDe(c, ag))[0]).toMatchObject({
        base_centavos: 33333,
        valor_centavos: 10000,
      });
      await c.query(
        `insert into cobrancas (origem, pacote_vendido_id, cliente_id, valor_bruto_centavos,
           desconto_centavos, caixa_id, lancada_por)
         values ('pacote', $1, $2, 100000, 40000, $3, $4)`,
        [pac, cli, caixa, donaId],
      );
      expect((await comissoesDe(c, ag))[0]).toMatchObject({
        base_centavos: 33333,
        valor_centavos: 10000,
      });
    });
  });

  it("desmarcar cancela; remarcar reabre a mesma linha recalculada", async () => {
    await comoUsuario(dona, async (c) => {
      await definirPct(c, { servico: 30 });
      await comoSuper(c);
      const ag = await agendar(c, { status: "atendido" });
      const id1 = (await c.query("select id from comissoes where agendamento_id = $1", [ag]))
        .rows[0].id;
      await logarComo(c, dona);
      await marcar(c, ag, "confirmado");
      expect((await comissoesDe(c, ag))[0]).toMatchObject({
        status: "cancelada",
        cancelada_motivo: "Atendimento desmarcado",
        tem_cancelada_em: true,
        valor_centavos: 6000,
      });
      // A % mudou enquanto estava desmarcado: ao remarcar, recalcula.
      await c.query("update servicos_comissao set percentual = 50 where servico_id = $1", [
        servico,
      ]);
      await marcar(c, ag, "atendido");
      const r = await c.query("select id from comissoes where agendamento_id = $1", [ag]);
      expect(r.rows).toEqual([{ id: id1 }]);
      expect((await comissoesDe(c, ag))[0]).toMatchObject({
        status: "aberta",
        cancelada_motivo: null,
        tem_cancelada_em: false,
        percentual: 50,
        valor_centavos: 10000,
      });
      await marcar(c, ag, "faltou");
      await marcar(c, ag, "atendido");
      expect(await contar(c, "comissoes")).toBe(1);
    });
  });

  it("profissional marcando o próprio atendido gera a comissão (e não a lê)", async () => {
    await comoUsuario(dona, async (c) => {
      await definirPct(c, { servico: 30 });
      await comoSuper(c);
      const ag = await agendar(c);
      await logarComo(c, prof);
      await marcar(c, ag, "atendido");
      expect(await contar(c, "comissoes")).toBe(0);
      await logarComo(c, dona);
      expect((await comissoesDe(c, ag))[0]).toMatchObject({
        status: "aberta",
        valor_centavos: 6000,
      });
    });
  });
});

describe("pagar_comissoes e resumos", () => {
  it("cria conta salario paga com a descrição exata e entra no resumo_financeiro", async () => {
    await comoUsuario(dona, async (c) => {
      await definirPct(c, { servico: 30 });
      await comoSuper(c);
      const a1 = await agendar(c, { status: "atendido" }); // 6000
      const a2 = await agendar(c, { status: "atendido", valor: 10000 }); // 3000
      const aDez = await agendar(c, {
        status: "atendido",
        inicio: "2026-12-01T03:30:00Z", // 2026-12-01 00:30 em SP
      });
      const aCancel = await agendar(c, { status: "atendido" });
      await marcar(c, aCancel, "confirmado");
      await logarComo(c, dona);

      const antes = (
        await c.query("select pago from resumo_financeiro('2026-11-01', '2026-11-30')")
      ).rows[0].pago;

      const resumo1 = (
        await c.query(
          "select profissional_id, nome, competencia::text, qtd, base, aberto, pago from resumo_comissoes('2026-11-15', '2026-12-31')",
        )
      ).rows;
      expect(resumo1).toEqual([
        {
          profissional_id: profId,
          nome: "Ana Lima",
          competencia: "2026-11-01",
          qtd: 2,
          base: "30000",
          aberto: "9000",
          pago: "0",
        },
        {
          profissional_id: profId,
          nome: "Ana Lima",
          competencia: "2026-12-01",
          qtd: 1,
          base: "20000",
          aberto: "6000",
          pago: "0",
        },
      ]);

      const conta = (
        await c.query<{ id: string }>(PAGAR, [profId, "2026-11-20", "2026-11-25", "pix"])
      ).rows[0].id;
      expect(conta).not.toBeNull();
      expect(
        (
          await c.query(
            `select descricao, categoria::text, status::text, valor_centavos, pago_em::text,
                    vencimento::text, forma::text, lancada_por, colaborador_id
             from contas_pagar where id = $1`,
            [conta],
          )
        ).rows[0],
      ).toEqual({
        descricao: "Comissão — Ana Lima — 11/2026",
        categoria: "salario",
        status: "paga",
        valor_centavos: 9000,
        pago_em: "2026-11-25",
        vencimento: "2026-11-25",
        forma: "pix",
        lancada_por: donaId,
        colaborador_id: null,
      });
      for (const ag of [a1, a2]) {
        expect((await comissoesDe(c, ag))[0]).toMatchObject({
          status: "paga",
          pago_em: "2026-11-25",
          conta_pagar_id: conta,
        });
      }
      expect((await comissoesDe(c, aDez))[0]).toMatchObject({ status: "aberta" });
      expect((await comissoesDe(c, aCancel))[0]).toMatchObject({ status: "cancelada" });

      const depois = (
        await c.query("select pago from resumo_financeiro('2026-11-01', '2026-11-30')")
      ).rows[0].pago;
      expect(Number(depois) - Number(antes)).toBe(9000);

      const resumo2 = (
        await c.query(
          "select competencia::text, aberto, pago from resumo_comissoes('2026-11-01', '2026-11-30')",
        )
      ).rows;
      expect(resumo2).toEqual([{ competencia: "2026-11-01", aberto: "0", pago: "9000" }]);

      // Desmarcar atendido com comissão paga: recusa e o status continua.
      expect((await falha(c, "update agendamentos set status = 'confirmado' where id = $1", [a1])).message).toBe(MSG_PAGA);
      expect(
        (await c.query("select status::text from agendamentos where id = $1", [a1])).rows[0]
          .status,
      ).toBe("atendido");

      // Segunda chamada: nada em aberto.
      expect(
        (await falha(c, PAGAR, [profId, "2026-11-01", "2026-11-25", "pix"])).message,
      ).toBe(MSG_SEM_ABERTAS);
    });
  });

  it("todas a 0%: marca pagas, devolve null e não cria conta", async () => {
    await comoUsuario(dona, async (c) => {
      await definirPct(c, {});
      await comoSuper(c);
      const ag = await agendar(c, { status: "atendido" });
      await logarComo(c, dona);
      const antes = await contar(c, "contas_pagar");
      const r = (await c.query(PAGAR, [profId, "2026-11-01", "2026-11-25", "dinheiro"])).rows[0];
      expect(r.id).toBeNull();
      expect(await contar(c, "contas_pagar")).toBe(antes);
      expect((await comissoesDe(c, ag))[0]).toMatchObject({
        status: "paga",
        pago_em: "2026-11-25",
        conta_pagar_id: null,
        valor_centavos: 0,
      });
    });
  });

  it("forma a_receber → 23514", async () => {
    await comoUsuario(dona, async (c) => {
      await definirPct(c, { servico: 30 });
      await comoSuper(c);
      await agendar(c, { status: "atendido" });
      await logarComo(c, dona);
      await falha(c, PAGAR, [profId, "2026-11-01", "2026-11-25", "a_receber"], "23514");
    });
  });
});

describe("acesso", () => {
  it("recepção, profissional e anon não leem percentuais nem comissões", async () => {
    await comoUsuario(dona, async (c) => {
      await definirPct(c, { servico: 30, prof: 10 });
      await comoSuper(c);
      await agendar(c, { status: "atendido" });
      await logarComo(c, dona);
      expect(await contar(c, "comissoes")).toBe(1);
      expect(await contar(c, "colaboradores_comissao")).toBe(1);
      expect(await contar(c, "servicos_comissao")).toBe(1);
      for (const uid of [recepcao, prof]) {
        await logarComo(c, uid);
        expect(await contar(c, "comissoes")).toBe(0);
        expect(await contar(c, "colaboradores_comissao")).toBe(0);
        expect(await contar(c, "servicos_comissao")).toBe(0);
        // Escrita: percentuais só a dona (RLS → 42501); comissões sem privilégio.
        await falha(
          c,
          "insert into servicos_comissao (servico_id, percentual) values ($1, 5)",
          [servicoSemPct],
          "42501",
        );
        await falha(c, "update comissoes set valor_centavos = 1", [], "42501");
        await falha(c, "select * from resumo_comissoes('2026-11-01', '2026-11-30')", []);
      }
      await logarComo(c, dona);
      await falha(c, "update comissoes set valor_centavos = 1", [], "42501");
      await falha(c, "delete from comissoes", [], "42501");
      await falha(c, "delete from colaboradores_comissao", [], "42501");
      await c.query("delete from servicos_comissao where servico_id = $1", [servico]);
      expect(await contar(c, "servicos_comissao")).toBe(0);
    });
    for (const t of ["comissoes", "colaboradores_comissao", "servicos_comissao"]) {
      await comoUsuario(null, (c) => esperarErroSql(c.query(`select * from ${t}`), "42501"));
    }
  });

  it("recepção e profissional chamando pagar_comissoes → mensagem da dona", async () => {
    for (const uid of [recepcao, prof]) {
      await comoUsuario(uid, async (c) => {
        expect(
          (await falha(c, PAGAR, [profId, "2026-11-01", "2026-11-25", "pix"])).message,
        ).toBe(MSG_DONA);
      });
    }
  });
});
