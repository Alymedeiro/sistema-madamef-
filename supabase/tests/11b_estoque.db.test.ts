import type { PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  aplicarMigracoes,
  comoSuperusuario,
  comoUsuario,
  contar,
  criarUsuario,
  esperarErroSql,
  fecharConexoes,
  resetarBanco,
} from "./helpers";

// 0011 (seções 3–4): movimentos de estoque, estoque_atual protegido, saldo
// anterior migrado, baixa/estorno automáticos pelo status do agendamento,
// entrada_estoque e ajustar_estoque.

const MSG_ESTOQUE = "O estoque só muda por entrada ou ajuste.";
const MSG_MESMA = "O estoque já está com essa quantidade.";
const MSG_MOTIVO = "Informe o motivo do ajuste.";
const MSG_QTD = "A quantidade deve ser maior que zero.";
const MSG_CONTADA = "A quantidade contada não pode ser negativa.";
const MSG_DONA = "Apenas a dona pode lançar contas.";
const MSG_PAGA = "A comissão deste atendimento já foi paga.";
const ENTRADA = "select entrada_estoque($1, $2, $3, $4, $5, $6) as id";
const AJUSTAR = "select ajustar_estoque($1, $2, $3) as id";

let dona: string;
let donaId: string;
let recepcao: string;
let recepcaoId: string;
let prof: string;
let profId: string;
let cli: string;
let servico: string; // Peeling: ácido 0,5 ml + luva 1 un
let servicoB: string; // Limpeza: algodão 2 un
let servicoVazio: string; // sem produtos
let acido: string; // estoque inicial 10
let luva: string; // estoque 0
let algodao: string; // estoque inicial 20
let antigo: string; // tinha 7,5 antes da 0011

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
  p: { status?: string; servico?: string } = {},
): Promise<string> {
  hora += 1;
  const r = await c.query<{ id: string }>(
    `insert into agendamentos (cliente_id, profissional_id, servico_id, inicio, fim,
       status, valor_previsto_centavos)
     values ($1, $2, $3, $4::timestamptz, $4::timestamptz + interval '30 minutes', $5, 20000)
     returning id`,
    [
      cli,
      profId,
      p.servico ?? servico,
      new Date(Date.UTC(2026, 10, 2, hora)).toISOString(),
      p.status ?? "confirmado",
    ],
  );
  return r.rows[0].id;
}

async function marcar(c: PoolClient, ag: string, status: string) {
  await c.query("update agendamentos set status = $2 where id = $1", [ag, status]);
}

/** Lê o saldo como superusuário e volta ao papel `uid` (ou fica superusuário). */
async function saldo(c: PoolClient, produto: string): Promise<number> {
  const r = await c.query<{ s: number }>(
    "select estoque_atual::float8 as s from produtos where id = $1",
    [produto],
  );
  return r.rows[0].s;
}

/** Superusuário: movimentos do agendamento, em ordem de criação. */
async function movimentosDe(c: PoolClient, ag: string) {
  return (
    await c.query(
      `select produto_id, tipo::text, quantidade::float8 as quantidade, motivo, responsavel_id
       from movimentos_estoque where agendamento_id = $1
       order by criado_em, tipo, produto_id`,
      [ag],
    )
  ).rows;
}

beforeAll(async () => {
  // Banco até a 0010 com um produto com saldo (dado antigo), depois a 0011.
  await resetarBanco({ ate: "0010" });
  ({ uid: dona, colaboradorId: donaId } = await criarUsuario("dona"));
  ({ uid: recepcao, colaboradorId: recepcaoId } = await criarUsuario("recepcao"));
  ({ uid: prof, colaboradorId: profId } = await criarUsuario("profissional"));
  await comoSuperusuario(async (c) => {
    antigo = (
      await c.query<{ id: string }>(
        "insert into produtos (nome, estoque_atual) values ('Antigo', 7.5) returning id",
      )
    ).rows[0].id;
    await c.query("insert into produtos (nome, estoque_atual) values ('Zerado', 0)");
  });
  await aplicarMigracoes("0011");

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
    servicoB = await serv("Limpeza");
    servicoVazio = await serv("Massagem");
    const prod = async (nome: string, unidade: string, inicial: number) => {
      const id = (
        await c.query<{ id: string }>(
          "insert into produtos (nome, unidade) values ($1, $2) returning id",
          [nome, unidade],
        )
      ).rows[0].id;
      if (inicial !== 0) {
        await c.query(
          `insert into movimentos_estoque (produto_id, tipo, quantidade, motivo)
           values ($1, 'ajuste', $2, 'Estoque inicial')`,
          [id, inicial],
        );
      }
      return id;
    };
    acido = await prod("Ácido glicólico", "ml", 10);
    luva = await prod("Luva", "un", 0);
    algodao = await prod("Algodão", "un", 20);
    await c.query(
      `insert into servico_produtos (servico_id, produto_id, quantidade)
       values ($1, $2, 0.5), ($1, $3, 1), ($4, $5, 2)`,
      [servico, acido, luva, servicoB, algodao],
    );
  });
});

afterAll(fecharConexoes);

describe("estrutura e migração", () => {
  it("enum, funções e privilégios", async () => {
    const r = await comoSuperusuario(async (c) => {
      const e = await c.query("select enum_range(null::tipo_movimento_estoque)::text[] as v");
      const f = await c.query(
        `select p.proname, has_function_privilege('authenticated', p.oid, 'execute') as auth,
                has_function_privilege('anon', p.oid, 'execute') as anon, p.prosecdef as definer
         from pg_proc p
         where p.pronamespace = 'public'::regnamespace
           and p.proname in ('movimentos_estoque_saldo', 'produtos_estoque_protegido',
                             'baixar_estoque_atendimento', 'estornar_estoque_atendimento',
                             'agendamentos_estoque', 'entrada_estoque', 'ajustar_estoque')
         order by p.proname`,
      );
      const t = await c.query(
        `select has_table_privilege('authenticated', 'movimentos_estoque', 'select') as sel,
                has_table_privilege('authenticated', 'movimentos_estoque', 'insert') as ins,
                has_table_privilege('authenticated', 'movimentos_estoque', 'update') as upd,
                has_table_privilege('authenticated', 'movimentos_estoque', 'delete') as del,
                has_table_privilege('service_role', 'movimentos_estoque', 'delete') as srv_del,
                has_table_privilege('service_role', 'movimentos_estoque', 'truncate') as srv_trunc,
                has_table_privilege('service_role', 'movimentos_estoque', 'update') as srv_upd,
                has_table_privilege('service_role', 'comissoes', 'update') as srv_upd_comissoes,
                has_table_privilege('anon', 'movimentos_estoque', 'select') as anon_sel`,
      );
      return { e: e.rows[0].v, f: f.rows, t: t.rows[0] };
    });
    expect(r.e).toEqual(["entrada", "ajuste", "baixa_atendimento", "estorno_atendimento"]);
    expect(r.f).toEqual([
      { proname: "agendamentos_estoque", auth: false, anon: false, definer: true },
      { proname: "ajustar_estoque", auth: true, anon: false, definer: true },
      { proname: "baixar_estoque_atendimento", auth: false, anon: false, definer: true },
      { proname: "entrada_estoque", auth: true, anon: false, definer: true },
      { proname: "estornar_estoque_atendimento", auth: false, anon: false, definer: true },
      { proname: "movimentos_estoque_saldo", auth: false, anon: false, definer: true },
      { proname: "produtos_estoque_protegido", auth: false, anon: false, definer: true },
    ]);
    expect(r.t).toEqual({
      sel: true,
      ins: false,
      upd: false,
      del: false,
      srv_del: false,
      srv_trunc: false,
      srv_upd: false,
      srv_upd_comissoes: false,
      anon_sel: false,
    });
  });

  it("produto com saldo antes da migração ganha o ajuste 'Saldo anterior' sem dobrar", async () => {
    await comoUsuario(dona, async (c) => {
      const r = await c.query(
        `select tipo::text, quantidade::float8 as quantidade, motivo, responsavel_id
         from movimentos_estoque where produto_id = $1`,
        [antigo],
      );
      expect(r.rows).toEqual([
        { tipo: "ajuste", quantidade: 7.5, motivo: "Saldo anterior", responsavel_id: null },
      ]);
      expect(await saldo(c, antigo)).toBe(7.5);
      // Produto zerado não ganha movimento.
      const z = await c.query(
        `select count(*)::int as n from movimentos_estoque m
         join produtos p on p.id = m.produto_id where p.nome = 'Zerado'`,
      );
      expect(z.rows[0].n).toBe(0);
    });
  });

  it("checks: entrada sem custo, baixa sem agendamento, ajuste sem motivo, quantidade 0 → 23514", async () => {
    await comoSuperusuario(async (c) => {
      const casos: [string, unknown[]][] = [
        ["insert into movimentos_estoque (produto_id, tipo, quantidade) values ($1, 'entrada', 1)", [acido]],
        [
          "insert into movimentos_estoque (produto_id, tipo, quantidade, custo_unitario_centavos) values ($1, 'entrada', -1, 10)",
          [acido],
        ],
        ["insert into movimentos_estoque (produto_id, tipo, quantidade) values ($1, 'baixa_atendimento', -1)", [acido]],
        ["insert into movimentos_estoque (produto_id, tipo, quantidade) values ($1, 'estorno_atendimento', 1)", [acido]],
        ["insert into movimentos_estoque (produto_id, tipo, quantidade) values ($1, 'ajuste', 1)", [acido]],
        [
          "insert into movimentos_estoque (produto_id, tipo, quantidade, motivo) values ($1, 'ajuste', 0, 'x')",
          [acido],
        ],
        [
          "insert into movimentos_estoque (produto_id, tipo, quantidade, motivo) values ($1, 'ajuste', 1, '  ')",
          [acido],
        ],
      ];
      for (const [sql, params] of casos) {
        await falha(c, sql, params, "23514");
      }
    });
  });
});

describe("estoque_atual protegido", () => {
  it("dona não muda estoque_atual direto; produto não nasce com estoque; outras colunas mudam", async () => {
    await comoUsuario(dona, async (c) => {
      expect(
        (await falha(c, "update produtos set estoque_atual = 10 where id = $1", [luva])).message,
      ).toBe(MSG_ESTOQUE);
      // O marcador sozinho (fora do gatilho de movimentos) não libera.
      await c.query("select set_config('app.movimento_estoque', '1', true)");
      expect(
        (await falha(c, "update produtos set estoque_atual = 10 where id = $1", [luva])).message,
      ).toBe(MSG_ESTOQUE);
      expect(
        (await falha(c, "insert into produtos (nome, estoque_atual) values ('Novo', 5)", []))
          .message,
      ).toBe(MSG_ESTOQUE);
      await c.query("update produtos set estoque_minimo = 3 where id = $1", [luva]);
      await c.query("insert into produtos (nome) values ('Novo')");
    });
    await comoSuperusuario(async (c) => {
      expect(
        (await falha(c, "update produtos set estoque_atual = 1 where id = $1", [luva])).message,
      ).toBe(MSG_ESTOQUE);
    });
  });
});

describe("baixa automática", () => {
  it("atendido baixa 0,5 e 1 (estoque pode ficar negativo); desmarcar estorna", async () => {
    await comoUsuario(dona, async (c) => {
      await comoSuper(c);
      const ag = await agendar(c);
      await logarComo(c, dona);
      await marcar(c, ag, "atendido");
      await comoSuper(c);
      expect(await saldo(c, acido)).toBe(9.5);
      expect(await saldo(c, luva)).toBe(-1);
      expect(await movimentosDe(c, ag)).toEqual(
        [
          { produto_id: acido, tipo: "baixa_atendimento", quantidade: -0.5, motivo: null, responsavel_id: donaId },
          { produto_id: luva, tipo: "baixa_atendimento", quantidade: -1, motivo: null, responsavel_id: donaId },
        ].sort((a, b) => (a.produto_id < b.produto_id ? -1 : 1)),
      );

      await logarComo(c, dona);
      await marcar(c, ag, "confirmado");
      await comoSuper(c);
      expect(await saldo(c, acido)).toBe(10);
      expect(await saldo(c, luva)).toBe(0);
      const estornos = (await movimentosDe(c, ag)).filter((m) => m.tipo === "estorno_atendimento");
      expect(estornos).toHaveLength(2);
      expect(estornos).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ produto_id: acido, quantidade: 0.5, motivo: "Atendimento desmarcado" }),
          expect.objectContaining({ produto_id: luva, quantidade: 1, motivo: "Atendimento desmarcado" }),
        ]),
      );
    });
  });

  it("atendido → confirmado → atendido: uma baixa líquida", async () => {
    await comoUsuario(dona, async (c) => {
      await comoSuper(c);
      const ag = await agendar(c, { status: "atendido" });
      await marcar(c, ag, "confirmado");
      await marcar(c, ag, "atendido");
      await marcar(c, ag, "faltou");
      await marcar(c, ag, "atendido");
      expect(await saldo(c, acido)).toBe(9.5);
      expect(await saldo(c, luva)).toBe(-1);
      const r = await c.query(
        `select tipo::text, count(*)::int as n from movimentos_estoque
         where agendamento_id = $1 group by tipo order by tipo`,
        [ag],
      );
      expect(r.rows).toEqual([
        { tipo: "baixa_atendimento", n: 6 },
        { tipo: "estorno_atendimento", n: 4 },
      ]);
      // Atualizar o status para o mesmo valor não baixa de novo.
      await marcar(c, ag, "atendido");
      expect(await saldo(c, acido)).toBe(9.5);
    });
  });

  it("produto removido do serviço depois da baixa: desmarcar ainda estorna o que baixou", async () => {
    await comoUsuario(dona, async (c) => {
      await comoSuper(c);
      const ag = await agendar(c, { status: "atendido" });
      await logarComo(c, dona);
      await c.query("delete from servico_produtos where servico_id = $1 and produto_id = $2", [
        servico,
        luva,
      ]);
      await c.query("update produtos set ativo = false where id = $1", [luva]);
      // Produto incluído no serviço depois da baixa não é "estornado".
      await c.query(
        "insert into servico_produtos (servico_id, produto_id, quantidade) values ($1, $2, 3)",
        [servico, algodao],
      );
      await marcar(c, ag, "confirmado");
      await comoSuper(c);
      expect(await saldo(c, acido)).toBe(10);
      expect(await saldo(c, luva)).toBe(0);
      expect(await saldo(c, algodao)).toBe(20);
      expect(
        (await movimentosDe(c, ag)).filter((m) => m.tipo === "estorno_atendimento").map((m) => m.produto_id).sort(),
      ).toEqual([acido, luva].sort());
    });
  });

  it("serviço sem produtos não gera movimento", async () => {
    await comoUsuario(dona, async (c) => {
      await comoSuper(c);
      const ag = await agendar(c, { status: "atendido", servico: servicoVazio });
      await marcar(c, ag, "confirmado");
      expect(await movimentosDe(c, ag)).toEqual([]);
    });
  });

  it("troca de serviço num atendido (P4B-R3): estorna o anterior e baixa o novo", async () => {
    await comoUsuario(dona, async (c) => {
      await comoSuper(c);
      const ag = await agendar(c, { status: "atendido" });
      await logarComo(c, dona);
      await c.query("update agendamentos set servico_id = $2 where id = $1", [ag, servicoB]);
      await comoSuper(c);
      expect(await saldo(c, acido)).toBe(10);
      expect(await saldo(c, luva)).toBe(0);
      expect(await saldo(c, algodao)).toBe(18);
      const estornos = (await movimentosDe(c, ag)).filter((m) => m.tipo === "estorno_atendimento");
      expect(estornos.map((m) => m.motivo)).toEqual(["Serviço alterado", "Serviço alterado"]);

      // Desmarcar agora estorna só o do serviço novo.
      await marcar(c, ag, "confirmado");
      expect(await saldo(c, acido)).toBe(10);
      expect(await saldo(c, luva)).toBe(0);
      expect(await saldo(c, algodao)).toBe(20);

      // Troca de serviço fora de 'atendido' não mexe no estoque.
      await c.query("update agendamentos set servico_id = $2 where id = $1", [ag, servico]);
      expect(await saldo(c, acido)).toBe(10);
      await marcar(c, ag, "atendido");
      expect(await saldo(c, acido)).toBe(9.5);
      expect(await saldo(c, algodao)).toBe(20);
    });
  });

  it("comissão paga bloqueia desmarcar: o estorno também é desfeito", async () => {
    await comoUsuario(dona, async (c) => {
      await comoSuper(c);
      const ag = await agendar(c, { status: "atendido" });
      await logarComo(c, dona);
      // Sem % configurada: paga com total 0 (sem conta).
      await c.query("select pagar_comissoes($1, '2026-11-01', '2026-11-25', 'pix')", [profId]);
      expect(
        (await falha(c, "update agendamentos set status = 'confirmado' where id = $1", [ag]))
          .message,
      ).toBe(MSG_PAGA);
      await comoSuper(c);
      expect(await saldo(c, acido)).toBe(9.5);
      expect(
        (await movimentosDe(c, ag)).filter((m) => m.tipo === "estorno_atendimento"),
      ).toEqual([]);
    });
  });

  it("recepção e profissional marcando atendido geram as baixas (e não as leem)", async () => {
    for (const [uid, colaboradorId] of [
      [recepcao, () => recepcaoId],
      [prof, () => profId],
    ] as const) {
      await comoUsuario(dona, async (c) => {
        await comoSuper(c);
        const ag = await agendar(c);
        await logarComo(c, uid);
        await marcar(c, ag, "atendido");
        expect(await contar(c, "movimentos_estoque")).toBe(0);
        await comoSuper(c);
        expect(await saldo(c, acido)).toBe(9.5);
        expect((await movimentosDe(c, ag)).map((m) => m.responsavel_id)).toEqual([
          colaboradorId(),
          colaboradorId(),
        ]);
        // Status final para a profissional: quem desmarca é a dona.
        await logarComo(c, dona);
        await marcar(c, ag, "confirmado");
        await comoSuper(c);
        expect(await saldo(c, acido)).toBe(10);
      });
    }
  });
});

describe("entrada_estoque", () => {
  it("entrada com despesa: saldo +3, custo 1250, conta produto aberta de 3750", async () => {
    await comoUsuario(dona, async (c) => {
      const id = (
        await c.query<{ id: string }>(ENTRADA, [acido, 3, 1250, true, "2026-12-10", "Fornecedor X"])
      ).rows[0].id;
      expect(await saldo(c, acido)).toBe(13);
      const m = (
        await c.query(
          `select tipo::text, quantidade::float8 as quantidade, custo_unitario_centavos,
                  conta_pagar_id, responsavel_id
           from movimentos_estoque where id = $1`,
          [id],
        )
      ).rows[0];
      expect(m).toMatchObject({
        tipo: "entrada",
        quantidade: 3,
        custo_unitario_centavos: 1250,
        responsavel_id: donaId,
      });
      expect(m.conta_pagar_id).not.toBeNull();
      expect(
        (
          await c.query("select custo_unitario_centavos from produtos_custos where produto_id = $1", [
            acido,
          ])
        ).rows,
      ).toEqual([{ custo_unitario_centavos: 1250 }]);
      expect(
        (
          await c.query(
            `select descricao, categoria::text, status::text, valor_centavos, vencimento::text,
                    fornecedor, lancada_por
             from contas_pagar where id = $1`,
            [m.conta_pagar_id],
          )
        ).rows[0],
      ).toEqual({
        descricao: "Compra — Ácido glicólico",
        categoria: "produto",
        status: "aberta",
        valor_centavos: 3750,
        vencimento: "2026-12-10",
        fornecedor: "Fornecedor X",
        lancada_por: donaId,
      });

      // Segunda entrada sem despesa: atualiza o custo, não cria conta.
      const contas = await contar(c, "contas_pagar");
      await c.query(ENTRADA, [acido, 0.25, 900, false, null, null]);
      expect(await saldo(c, acido)).toBe(13.25);
      expect(await contar(c, "contas_pagar")).toBe(contas);
      expect(
        (
          await c.query("select custo_unitario_centavos from produtos_custos where produto_id = $1", [
            acido,
          ])
        ).rows[0].custo_unitario_centavos,
      ).toBe(900);
      // Custo 0 com "lançar despesa": total 0, sem conta.
      await c.query(ENTRADA, [luva, 5, 0, true, "2026-12-10", null]);
      expect(await contar(c, "contas_pagar")).toBe(contas);
      expect(await saldo(c, luva)).toBe(5);
    });
  });

  it("quantidade ≤ 0 → mensagem; custo nulo ou negativo → 23514", async () => {
    await comoUsuario(dona, async (c) => {
      for (const q of [0, -1, null]) {
        expect((await falha(c, ENTRADA, [acido, q, 100, false, null, null])).message).toBe(MSG_QTD);
      }
      await falha(c, ENTRADA, [acido, 1, null, false, null, null], "23514");
      await falha(c, ENTRADA, [acido, 1, -5, false, null, null], "23514");
    });
  });
});

describe("ajustar_estoque", () => {
  it("grava a diferença; mesma quantidade, sem motivo e negativa → mensagens", async () => {
    await comoUsuario(dona, async (c) => {
      expect((await falha(c, AJUSTAR, [acido, 10, "Contagem"])).message).toBe(MSG_MESMA);
      expect((await falha(c, AJUSTAR, [acido, 8, "  "])).message).toBe(MSG_MOTIVO);
      expect((await falha(c, AJUSTAR, [acido, 8, null])).message).toBe(MSG_MOTIVO);
      expect((await falha(c, AJUSTAR, [acido, -1, "Contagem"])).message).toBe(MSG_CONTADA);

      const id = (await c.query<{ id: string }>(AJUSTAR, [acido, 7.25, " Contagem "])).rows[0].id;
      expect(await saldo(c, acido)).toBe(7.25);
      expect(
        (
          await c.query(
            `select tipo::text, quantidade::float8 as quantidade, motivo, responsavel_id
             from movimentos_estoque where id = $1`,
            [id],
          )
        ).rows[0],
      ).toEqual({ tipo: "ajuste", quantidade: -2.75, motivo: "Contagem", responsavel_id: donaId });
      // Saldo negativo → contagem 0 grava ajuste positivo.
      await comoSuper(c);
      const ag = await agendar(c, { status: "atendido" });
      expect(await saldo(c, luva)).toBe(-1);
      await logarComo(c, dona);
      await c.query(AJUSTAR, [luva, 0, "Contagem"]);
      expect(await saldo(c, luva)).toBe(0);
      expect(ag).toBeTruthy();
    });
  });
});

describe("conciliação", () => {
  it("soma dos movimentos = estoque_atual em todos os produtos após um roteiro", async () => {
    await comoUsuario(dona, async (c) => {
      await comoSuper(c);
      const a1 = await agendar(c, { status: "atendido" });
      const a2 = await agendar(c);
      const a3 = await agendar(c, { status: "atendido", servico: servicoB });
      await logarComo(c, prof);
      await marcar(c, a2, "atendido");
      await logarComo(c, dona);
      await c.query(ENTRADA, [acido, 3, 1250, true, "2026-12-10", "Fornecedor X"]);
      await marcar(c, a1, "confirmado");
      await c.query(AJUSTAR, [algodao, 15, "Perda"]);
      await c.query("delete from servico_produtos where servico_id = $1", [servico]);
      await marcar(c, a2, "faltou");
      await marcar(c, a1, "atendido");
      await c.query("update agendamentos set servico_id = $2 where id = $1", [a3, servico]);
      await c.query(AJUSTAR, [luva, 4, "Contagem"]);
      await comoSuper(c);
      const r = await c.query(
        `select p.nome, p.estoque_atual::float8 as saldo,
                coalesce((select sum(m.quantidade) from movimentos_estoque m
                          where m.produto_id = p.id), 0)::float8 as soma
         from produtos p order by p.nome`,
      );
      expect(r.rows.length).toBeGreaterThanOrEqual(5);
      for (const linha of r.rows) {
        expect(linha.soma, linha.nome).toBe(linha.saldo);
      }
      expect(await saldo(c, acido)).toBe(13);
    });
  });
});

describe("acesso", () => {
  it("recepção e profissional não leem movimentos nem chamam as funções; ninguém escreve direto", async () => {
    await comoUsuario(dona, async (c) => {
      expect(await contar(c, "movimentos_estoque")).toBeGreaterThan(0);
      for (const uid of [recepcao, prof]) {
        await logarComo(c, uid);
        expect(await contar(c, "movimentos_estoque")).toBe(0);
        expect(
          (await falha(c, ENTRADA, [acido, 1, 100, false, null, null])).message,
        ).toBe(MSG_DONA);
        expect((await falha(c, AJUSTAR, [acido, 1, "x"])).message).toBe(MSG_DONA);
      }
      for (const uid of [dona, recepcao, prof]) {
        await logarComo(c, uid);
        await falha(
          c,
          "insert into movimentos_estoque (produto_id, tipo, quantidade, motivo) values ($1, 'ajuste', 1, 'x')",
          [acido],
          "42501",
        );
        await falha(c, "update movimentos_estoque set quantidade = 1", [], "42501");
        await falha(c, "delete from movimentos_estoque", [], "42501");
      }
    });
    await comoUsuario(null, (c) =>
      esperarErroSql(c.query("select * from movimentos_estoque"), "42501"),
    );
    await comoUsuario(null, (c) =>
      esperarErroSql(c.query(AJUSTAR, [acido, 1, "x"]), "42501"),
    );
  });

  it("service_role (E2E): não atualiza movimentos nem comissões; libera o horário cancelando ou movendo", async () => {
    const comoServico = async (c: PoolClient) => {
      await c.query("set local role service_role");
      await c.query("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify({ role: "service_role" }),
      ]);
    };
    await comoUsuario(dona, async (c) => {
      await comoSuper(c);
      const aberto = await agendar(c, { status: "atendido" });
      expect(await saldo(c, acido)).toBe(9.5);

      await comoServico(c);
      await falha(c, "update movimentos_estoque set quantidade = 100 where agendamento_id = $1", [aberto], "42501");
      await falha(c, "update comissoes set valor_centavos = 1 where agendamento_id = $1", [aberto], "42501");
      await falha(c, "delete from movimentos_estoque where agendamento_id = $1", [aberto], "42501");

      // Comissão em aberto: cancelar (como liberarHorario) cancela a comissão e estorna.
      await c.query("update agendamentos set status = 'cancelado' where id = $1", [aberto]);
      await comoSuper(c);
      expect(await saldo(c, acido)).toBe(10);
      let r = await c.query("select status::text from comissoes where agendamento_id = $1", [aberto]);
      expect(r.rows).toEqual([{ status: "cancelada" }]);

      // Comissão paga: cancelar é recusado, mas mover início/fim para o passado é aceito.
      const pago = await agendar(c, { status: "atendido" });
      await logarComo(c, dona);
      await c.query("select pagar_comissoes($1, '2026-11-01', '2026-11-25', 'pix')", [profId]);
      await comoServico(c);
      expect(
        (await falha(c, "update agendamentos set status = 'cancelado' where id = $1", [pago])).message,
      ).toBe(MSG_PAGA);
      await c.query(
        `update agendamentos set inicio = '2003-05-06T07:08:00Z', fim = '2003-05-06T07:09:00Z'
         where id = $1`,
        [pago],
      );
      await comoSuper(c);
      r = await c.query(
        "select status::text, competencia::text from comissoes where agendamento_id = $1",
        [pago],
      );
      expect(r.rows).toEqual([{ status: "paga", competencia: "2026-11-01" }]);
      expect(await saldo(c, acido)).toBe(9.5);
    });
  });
});
