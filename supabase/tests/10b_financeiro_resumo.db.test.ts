import type { PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  comoSuperusuario,
  comoUsuario,
  contar,
  criarUsuario,
  esperarErroSql,
  fecharConexoes,
  inserirPagamentoDireto,
  resetarBanco,
} from "./helpers";

// 0010 (seção 6): resumo financeiro, fluxo de caixa, avisos lidos e relatórios.

const MSG_ACESSO = "Acesso não autorizado";

let dona: string;
let donaId: string;
let outraDona: string;
let recepcao: string;
let prof: string;
let cli: string;

async function logarComo(c: PoolClient, uid: string) {
  await c.query("set local role authenticated");
  await c.query("select set_config('request.jwt.claims', $1, true)", [
    JSON.stringify({ sub: uid, role: "authenticated" }),
  ]);
}

/** Espera o erro sem abortar a transação (savepoint). */
async function falha(c: PoolClient, sql: string, params: unknown[] = [], sqlstate = "P0001") {
  await c.query("savepoint tentativa");
  const erro = await esperarErroSql(c.query(sql, params), sqlstate);
  await c.query("rollback to savepoint tentativa");
  return erro;
}

async function caixa(c: PoolClient, data: string): Promise<string> {
  return (
    await c.query<{ id: string }>(
      `insert into caixas (data, aberto_por, valor_inicial_centavos) values ($1, $2, 0) returning id`,
      [data, donaId],
    )
  ).rows[0].id;
}

async function contaPagar(
  c: PoolClient,
  p: { valor: number; vencimento: string; status?: string; pagoEm?: string; categoria?: string },
) {
  const status = p.status ?? "aberta";
  await c.query(
    `insert into contas_pagar (descricao, categoria, valor_centavos, vencimento, status, pago_em,
       forma, cancelada_motivo, cancelada_em, cancelada_por, lancada_por)
     values ('Conta', $1, $2, $3, $4::status_conta, $5,
       case when $4::text = 'paga' then 'pix'::forma_pagamento end,
       case when $4::text = 'cancelada' then 'erro' end,
       case when $4::text = 'cancelada' then now() end,
       case when $4::text = 'cancelada' then $6::uuid end, $6)`,
    [p.categoria ?? "fornecedor", p.valor, p.vencimento, status, p.pagoEm ?? null, donaId],
  );
}

/**
 * Cenário do plano (superusuário, dentro da transação do teste):
 * - pagamento pix 200,00 com 20,00 de desconto no caixa de 05/11;
 * - pagamento a_receber 300,00 (05/11) em 3 parcelas de 100,00 vencendo 05/11,
 *   05/12 e 05/01; a primeira recebida em dinheiro em 06/11 às 23:30 de SP
 *   (07/11 em UTC);
 * - conta paga 80,00 em 10/11; conta aberta 50,00 vencendo 03/11;
 * - conta a pagar cancelada 999,00 e conta a receber cancelada 999,00 em novembro.
 */
async function montarCenario(c: PoolClient) {
  await c.query("reset role");
  const cx5 = await caixa(c, "2026-11-05");
  const cx6 = await caixa(c, "2026-11-06");
  const base = { clienteId: cli, origem: "venda_produto", lancadoPor: donaId };
  await inserirPagamentoDireto(c, { ...base, caixaId: cx5, forma: "pix", valor: 20000, desconto: 2000 });
  const pagAR = await inserirPagamentoDireto(c, {
    ...base,
    caixaId: cx5,
    forma: "a_receber",
    valor: 30000,
  });
  const parcelas = await c.query<{ id: string }>(
    `insert into contas_receber (cliente_id, pagamento_id, numero, total_parcelas, valor_centavos, vencimento)
     values ($1, $2, 1, 3, 10000, '2026-11-05'), ($1, $2, 2, 3, 10000, '2026-12-05'),
            ($1, $2, 3, 3, 10000, '2027-01-05')
     returning id`,
    [cli, pagAR],
  );
  const primeira = parcelas.rows[0].id;
  const recebidoEm = "2026-11-06 23:30:00-03";
  await c.query("update contas_receber set recebido_em = $2 where id = $1", [primeira, recebidoEm]);
  await c.query(
    `insert into recebimentos (conta_receber_id, caixa_id, forma, valor_centavos, recebido_por, recebido_em)
     values ($1, $2, 'dinheiro', 10000, $3, $4)`,
    [primeira, cx6, donaId, recebidoEm],
  );
  await c.query(
    `insert into contas_receber (cliente_id, descricao, origem_manual, numero, total_parcelas,
       valor_centavos, vencimento, lancada_por, cancelada_motivo, cancelada_em, cancelada_por)
     values ($1, 'Cancelada', true, 1, 1, 99900, '2026-11-20', $2, 'erro', now(), $2)`,
    [cli, donaId],
  );
  await contaPagar(c, { valor: 8000, vencimento: "2026-11-10", status: "paga", pagoEm: "2026-11-10" });
  await contaPagar(c, { valor: 5000, vencimento: "2026-11-03" });
  await contaPagar(c, { valor: 99900, vencimento: "2026-11-15", status: "cancelada" });
  await logarComo(c, dona);
}

const SQL_RESUMO = "select * from resumo_financeiro($1, $2)";
const SQL_FLUXO = "select periodo::text, entradas, saidas from fluxo_caixa($1, $2, $3)";

/** bigint chega como string pelo pg: converte para número. */
const num = (r: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === "string" && /^-?\d+$/.test(v) ? Number(v) : v]));

beforeAll(async () => {
  await resetarBanco();
  ({ uid: dona, colaboradorId: donaId } = await criarUsuario("dona"));
  ({ uid: outraDona } = await criarUsuario("dona"));
  ({ uid: recepcao } = await criarUsuario("recepcao"));
  ({ uid: prof } = await criarUsuario("profissional"));
  cli = await comoSuperusuario(
    async (c) =>
      (
        await c.query<{ id: string }>(
          "insert into clientes (nome, aceite_lgpd_em) values ('Maria Souza', now()) returning id",
        )
      ).rows[0].id,
  );
});

afterAll(fecharConexoes);

describe("resumo_financeiro", () => {
  it("novembro: recebido sem a_receber e sem dobrar a parcela; cancelada nunca entra", async () => {
    await comoUsuario(dona, async (c) => {
      await montarCenario(c);
      const r = num((await c.query(SQL_RESUMO, ["2026-11-01", "2026-11-30"])).rows[0]);
      const hoje = (
        await c.query<{ d: string }>("select ((now() at time zone 'America/Sao_Paulo')::date)::text as d")
      ).rows[0].d;
      // Em aberto do cenário (pagar 50,00 em 03/11; parcelas 05/12 e 05/01).
      const abertos = [
        { venc: "2026-11-03", valor: 5000 },
        { venc: "2026-12-05", valor: 10000 },
        { venc: "2027-01-05", valor: 10000 },
      ].filter((x) => x.venc < hoje);
      expect(r).toEqual({
        recebido: 28000,
        recebido_qtd: 2,
        pago: 8000,
        pago_qtd: 1,
        a_receber: 0,
        ja_recebido: 10000,
        a_pagar: 5000,
        ja_pago: 8000,
        a_receber_vencido: 0,
        a_pagar_vencido: "2026-11-03" < hoje ? 5000 : 0,
        vencidos_qtd: abertos.length,
        vencidos_total: abertos.reduce((s, x) => s + x.valor, 0),
      });
      expect(abertos.map((x) => x.venc)).toContain("2026-11-03");
    });
  });

  it("dezembro e limites do período (dias de São Paulo, intervalo fechado)", async () => {
    await comoUsuario(dona, async (c) => {
      await montarCenario(c);
      const dez = num((await c.query(SQL_RESUMO, ["2026-12-01", "2026-12-31"])).rows[0]);
      expect(dez).toMatchObject({
        recebido: 0,
        recebido_qtd: 0,
        pago: 0,
        pago_qtd: 0,
        a_receber: 10000,
        ja_recebido: 0,
        a_pagar: 0,
        ja_pago: 0,
      });
      // Um dia só: 05/11 tem o pagamento (caixa) e a parcela vencendo, recebida.
      expect(num((await c.query(SQL_RESUMO, ["2026-11-05", "2026-11-05"])).rows[0])).toMatchObject({
        recebido: 18000,
        recebido_qtd: 1,
        ja_recebido: 10000,
      });
      // Recebimento às 23:30 de 06/11 (SP) é 06/11, não 07/11.
      expect(num((await c.query(SQL_RESUMO, ["2026-11-06", "2026-11-06"])).rows[0])).toMatchObject({
        recebido: 10000,
        recebido_qtd: 1,
      });
      expect(num((await c.query(SQL_RESUMO, ["2026-11-07", "2026-11-07"])).rows[0])).toMatchObject({
        recebido: 0,
        recebido_qtd: 0,
      });
      expect(num((await c.query(SQL_RESUMO, ["2026-11-10", "2026-11-10"])).rows[0])).toMatchObject({
        pago: 8000,
        pago_qtd: 1,
        ja_pago: 8000,
      });
    });
  });

  it("sem movimento: zeros (nunca nulo)", async () => {
    await comoUsuario(dona, async (c) => {
      const r = num((await c.query(SQL_RESUMO, ["2026-11-01", "2026-11-30"])).rows[0]);
      expect(r).toEqual({
        recebido: 0,
        recebido_qtd: 0,
        pago: 0,
        pago_qtd: 0,
        a_receber: 0,
        ja_recebido: 0,
        a_pagar: 0,
        ja_pago: 0,
        a_receber_vencido: 0,
        a_pagar_vencido: 0,
        vencidos_qtd: 0,
        vencidos_total: 0,
      });
    });
  });

  it("a_receber_vencido / a_pagar_vencido: só a parte em aberto de P com vencimento < hoje", async () => {
    await comoUsuario(dona, async (c) => {
      await c.query("reset role");
      const hoje = (
        await c.query<{ d: string }>("select ((now() at time zone 'America/Sao_Paulo')::date)::text as d")
      ).rows[0].d;
      const dia = async (n: number) =>
        (await c.query<{ d: string }>("select ($1::date + $2::int)::text as d", [hoje, n])).rows[0].d;
      const [ontem, amanha, mesPassado] = [await dia(-1), await dia(1), await dia(-40)];
      await contaPagar(c, { valor: 1000, vencimento: ontem });
      await contaPagar(c, { valor: 2000, vencimento: hoje });
      await contaPagar(c, { valor: 4000, vencimento: amanha });
      await contaPagar(c, { valor: 8000, vencimento: ontem, status: "paga", pagoEm: ontem });
      await contaPagar(c, { valor: 16000, vencimento: ontem, status: "cancelada" });
      await contaPagar(c, { valor: 32000, vencimento: mesPassado });
      await c.query(
        `insert into contas_receber (cliente_id, descricao, origem_manual, numero, total_parcelas,
           valor_centavos, vencimento, lancada_por)
         values ($1, 'A', true, 1, 1, 300, $3, $2), ($1, 'B', true, 1, 1, 500, $4, $2),
                ($1, 'C', true, 1, 1, 700, $5, $2)`,
        [cli, donaId, ontem, hoje, mesPassado],
      );
      await logarComo(c, dona);
      const r = num((await c.query(SQL_RESUMO, [await dia(-10), amanha])).rows[0]);
      expect(r).toMatchObject({
        a_pagar: 7000,
        a_pagar_vencido: 1000,
        a_receber: 800,
        a_receber_vencido: 300,
      });
    });
  });
});

describe("fluxo de caixa", () => {
  it("por dia em novembro: só dias com movimento", async () => {
    await comoUsuario(dona, async (c) => {
      await montarCenario(c);
      const r = await c.query(SQL_FLUXO, ["2026-11-01", "2026-11-30", "dia"]);
      expect(r.rows.map(num)).toEqual([
        { periodo: "2026-11-05", entradas: 18000, saidas: 0 },
        { periodo: "2026-11-06", entradas: 10000, saidas: 0 },
        { periodo: "2026-11-10", entradas: 0, saidas: 8000 },
      ]);
    });
  });

  it("por mês: novembro a janeiro agrupa no 1º dia do mês", async () => {
    await comoUsuario(dona, async (c) => {
      await montarCenario(c);
      const r = await c.query(SQL_FLUXO, ["2026-11-01", "2027-01-31", "mes"]);
      expect(r.rows.map(num)).toEqual([{ periodo: "2026-11-01", entradas: 28000, saidas: 8000 }]);
      expect((await falha(c, SQL_FLUXO, ["2026-11-01", "2026-11-30", "semana"])).message).toBe(
        "Agrupamento inválido.",
      );
    });
  });

  it("por forma (entradas) e despesas por categoria (pagas)", async () => {
    await comoUsuario(dona, async (c) => {
      await montarCenario(c);
      const formas = await c.query(
        "select forma, total from fluxo_por_forma('2026-11-01', '2026-11-30')",
      );
      expect(formas.rows.map(num)).toEqual([
        { forma: "pix", total: 18000 },
        { forma: "dinheiro", total: 10000 },
      ]);
      const cats = await c.query(
        "select categoria, total from despesas_por_categoria('2026-11-01', '2026-11-30')",
      );
      expect(cats.rows.map(num)).toEqual([{ categoria: "fornecedor", total: 8000 }]);
    });
  });
});

describe("acesso às funções de leitura", () => {
  const chamadas = [
    "select * from resumo_financeiro('2026-11-01', '2026-11-30')",
    "select * from fluxo_caixa('2026-11-01', '2026-11-30', 'dia')",
    "select * from fluxo_por_forma('2026-11-01', '2026-11-30')",
    "select * from despesas_por_categoria('2026-11-01', '2026-11-30')",
    "select marcar_avisos_lidos(array['pagar:x:7'])",
    "select registrar_relatorio('painel', '2026-11-01', '2026-11-30')",
  ];

  it("recepção e profissional → 'Acesso não autorizado'; anon → 42501", async () => {
    for (const uid of [recepcao, prof]) {
      await comoUsuario(uid, async (c) => {
        for (const sql of chamadas) expect((await falha(c, sql)).message).toBe(MSG_ACESSO);
      });
    }
    for (const sql of chamadas) {
      await comoUsuario(null, (c) => esperarErroSql(c.query(sql), "42501"));
    }
  });
});

describe("avisos lidos", () => {
  it("marcar é idempotente; cada dona lê só os próprios; recepção nada", async () => {
    await comoUsuario(dona, async (c) => {
      const chaves = ["pagar:abc:7", "receber:def:vencida:2026-11-10"];
      await c.query("select marcar_avisos_lidos($1)", [chaves]);
      await c.query("select marcar_avisos_lidos($1)", [[...chaves, "pagar:abc:7"]]);
      const r = await c.query(
        "select colaborador_id, chave, lido_em is not null as tem from avisos_lidos order by chave",
      );
      expect(r.rows).toEqual([
        { colaborador_id: donaId, chave: "pagar:abc:7", tem: true },
        { colaborador_id: donaId, chave: "receber:def:vencida:2026-11-10", tem: true },
      ]);
      await c.query("select marcar_avisos_lidos($1)", [[]]);
      expect(await contar(c, "avisos_lidos")).toBe(2);
      await falha(c, "select marcar_avisos_lidos($1)", [[""]], "23514");
      await falha(c, "select marcar_avisos_lidos($1)", [["x".repeat(121)]], "23514");
      await falha(
        c,
        "insert into avisos_lidos (colaborador_id, chave) values ($1, 'x')",
        [donaId],
        "42501",
      );
      await falha(c, "delete from avisos_lidos", [], "42501");

      await logarComo(c, outraDona);
      expect(await contar(c, "avisos_lidos")).toBe(0);
      await c.query("select marcar_avisos_lidos(array['pagar:abc:7'])");
      expect(await contar(c, "avisos_lidos")).toBe(1);

      await logarComo(c, recepcao);
      expect(await contar(c, "avisos_lidos")).toBe(0);
    });
    await comoUsuario(null, (c) => esperarErroSql(c.query("select * from avisos_lidos"), "42501"));
  });
});

describe("avisos lidos: renovação", () => {
  it("marcar de novo uma chave antiga renova lido_em para agora", async () => {
    const chave = "pagar:antiga:7";
    await comoSuperusuario((c) =>
      c.query(
        "insert into avisos_lidos (colaborador_id, chave, lido_em) values ($1, $2, now() - interval '3 days')",
        [donaId, chave],
      ),
    );
    try {
      await comoUsuario(dona, async (c) => {
        await c.query("select marcar_avisos_lidos(array[$1]::text[])", [chave]);
        const r = await c.query<{ recente: boolean; n: string }>(
          "select lido_em >= now() - interval '1 minute' as recente, (select count(*) from avisos_lidos where chave = $1) as n from avisos_lidos where chave = $1",
          [chave],
        );
        expect(r.rows).toEqual([{ recente: true, n: "1" }]);
      });
    } finally {
      await comoSuperusuario((c) => c.query("delete from avisos_lidos where chave = $1", [chave]));
    }
  });
});

describe("relatórios gerados", () => {
  it("registra aba e período da dona; só dona lê; de > ate → 23514", async () => {
    await comoUsuario(dona, async (c) => {
      await c.query("select registrar_relatorio('pagar', '2026-11-01', '2026-11-30')");
      const r = await c.query(
        "select colaborador_id, aba, de::text, ate::text, gerado_em = now() as agora from relatorios_gerados",
      );
      expect(r.rows).toEqual([
        { colaborador_id: donaId, aba: "pagar", de: "2026-11-01", ate: "2026-11-30", agora: true },
      ]);
      await falha(c, "select registrar_relatorio('pagar', '2026-12-01', '2026-11-30')", [], "23514");
      await falha(c, "select registrar_relatorio('', '2026-11-01', '2026-11-30')", [], "23514");
      await falha(
        c,
        "insert into relatorios_gerados (colaborador_id, aba, de, ate) values ($1, 'x', now(), now())",
        [donaId],
        "42501",
      );
      await logarComo(c, outraDona);
      expect(await contar(c, "relatorios_gerados")).toBe(1);
      for (const uid of [recepcao, prof]) {
        await logarComo(c, uid);
        expect(await contar(c, "relatorios_gerados")).toBe(0);
      }
    });
    await comoUsuario(null, (c) =>
      esperarErroSql(c.query("select * from relatorios_gerados"), "42501"),
    );
  });
});
