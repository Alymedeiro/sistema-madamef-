import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  abrirConexao,
  comoSuperusuario,
  comoUsuario,
  contar,
  criarUsuario,
  esperarErroSql,
  fecharConexoes,
  resetarBanco,
} from "./helpers";

// 0010 (seções 1–3): contas a pagar, contas fixas, vale e o bucket `financeiro`.

const MSG_DONA = "Apenas a dona pode lançar contas.";
const MSG_PAGA = "Esta conta já foi paga.";
const MSG_CANCELADA = "Esta conta foi cancelada.";
const MSG_MOTIVO = "Informe o motivo do cancelamento.";

let dona: string;
let donaId: string;
let recepcao: string;
let recepcaoIdAtual: string;
let prof: string;
let profId: string;

const SQL_CRIAR = "select criar_conta_pagar($1, $2, $3, $4, $5, $6) as id";
const criarParams = (p: { anexo?: string | null; categoria?: string } = {}) => [
  "Conta de luz",
  p.categoria ?? "outros",
  "Enel",
  15000,
  "2026-11-20",
  p.anexo ?? null,
];

const SQL_OBJ = "insert into storage.objects (bucket_id, name) values ('financeiro', $1)";
const anexo = (ext = "pdf") => `contas_pagar/${randomUUID()}.${ext}`;

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

async function criarConta(c: PoolClient, p: { anexo?: string | null } = {}): Promise<string> {
  return (await c.query<{ id: string }>(SQL_CRIAR, criarParams(p))).rows[0].id;
}

async function conta(c: PoolClient, id: string) {
  const r = await c.query(
    `select status, categoria, colaborador_id, descricao, valor_centavos,
            vencimento::text, pago_em::text, forma, cancelada_motivo,
            cancelada_em is not null as tem_cancelada_em, cancelada_por, lancada_por, anexo_path
     from contas_pagar where id = $1`,
    [id],
  );
  return r.rows[0];
}

beforeAll(async () => {
  await resetarBanco();
  ({ uid: dona, colaboradorId: donaId } = await criarUsuario("dona"));
  ({ uid: recepcao, colaboradorId: recepcaoIdAtual } = await criarUsuario("recepcao"));
  ({ uid: prof, colaboradorId: profId } = await criarUsuario("profissional", {
    nome: "Ana Lima",
  }));
});

afterAll(fecharConexoes);

describe("acesso a contas_pagar e contas_fixas", () => {
  it("só a dona lê; recepção e profissional veem 0 linhas; anon recebe 42501", async () => {
    await comoUsuario(dona, async (c) => {
      await criarConta(c);
      await c.query("select criar_conta_fixa('Aluguel', 'aluguel', null, 250000, 10, '2026-11-01')");
      expect(await contar(c, "contas_pagar")).toBe(1);
      expect(await contar(c, "contas_fixas")).toBe(1);
      for (const uid of [recepcao, prof]) {
        await logarComo(c, uid);
        expect(await contar(c, "contas_pagar")).toBe(0);
        expect(await contar(c, "contas_fixas")).toBe(0);
      }
    });
    await comoUsuario(null, (c) => esperarErroSql(c.query("select * from contas_pagar"), "42501"));
    await comoUsuario(null, (c) => esperarErroSql(c.query("select * from contas_fixas"), "42501"));
  });

  it("authenticated não insere, atualiza nem apaga (42501)", async () => {
    await comoUsuario(dona, async (c) => {
      const id = await criarConta(c);
      const fixa = (
        await c.query<{ id: string }>(
          "select criar_conta_fixa('Aluguel', 'aluguel', null, 250000, 10, '2026-11-01') as id",
        )
      ).rows[0].id;
      await falha(
        c,
        `insert into contas_pagar (descricao, categoria, valor_centavos, vencimento, lancada_por)
         values ('X', 'outros', 100, '2026-11-20', $1)`,
        [donaId],
        "42501",
      );
      await falha(c, "update contas_pagar set valor_centavos = 1 where id = $1", [id], "42501");
      await falha(c, "delete from contas_pagar where id = $1", [id], "42501");
      await falha(c, "update contas_fixas set ativa = false where id = $1", [fixa], "42501");
      await falha(c, "delete from contas_fixas where id = $1", [fixa], "42501");
      await logarComo(c, recepcao);
      await falha(c, "delete from contas_pagar where id = $1", [id], "42501");
    });
  });

  it("recepção e profissional não lançam contas", async () => {
    for (const uid of [recepcao, prof]) {
      await comoUsuario(uid, async (c) => {
        const e = await falha(c, SQL_CRIAR, criarParams());
        expect(e.message).toBe(MSG_DONA);
        expect(
          (await falha(c, "select lancar_vale($1, 5000, '2026-11-10', 'pix', null)", [profId]))
            .message,
        ).toBe(MSG_DONA);
        expect(
          (
            await falha(
              c,
              "select criar_conta_fixa('Aluguel', 'aluguel', null, 250000, 10, '2026-11-01')",
              [],
            )
          ).message,
        ).toBe(MSG_DONA);
        expect((await falha(c, "select gerar_contas_fixas('2027-01-31')", [])).message).toBe(
          MSG_DONA,
        );
        expect(
          (await falha(c, "select pagar_conta($1, '2026-11-10', 'pix')", [randomUUID()])).message,
        ).toBe(MSG_DONA);
        expect(
          (await falha(c, "select cancelar_conta_pagar($1, 'x')", [randomUUID()])).message,
        ).toBe(MSG_DONA);
      });
    }
  });
});

describe("criar, editar, pagar e cancelar", () => {
  it("cria aberta com lancada_por da dona", async () => {
    await comoUsuario(dona, async (c) => {
      const id = await criarConta(c);
      expect(await conta(c, id)).toMatchObject({
        status: "aberta",
        categoria: "outros",
        descricao: "Conta de luz",
        valor_centavos: 15000,
        vencimento: "2026-11-20",
        pago_em: null,
        forma: null,
        lancada_por: donaId,
        anexo_path: null,
      });
    });
  });

  it("valida descrição, valor e categoria vale fora do lançar vale (23514)", async () => {
    await comoUsuario(dona, async (c) => {
      await falha(c, SQL_CRIAR, ["   ", "outros", null, 100, "2026-11-20", null], "23514");
      await falha(c, SQL_CRIAR, ["x".repeat(121), "outros", null, 100, "2026-11-20", null], "23514");
      await falha(c, SQL_CRIAR, ["X", "outros", null, 0, "2026-11-20", null], "23514");
      await falha(c, SQL_CRIAR, criarParams({ categoria: "vale" }), "23514");
    });
  });

  it("pagar duas vezes → mensagem; forma a_receber → 23514", async () => {
    await comoUsuario(dona, async (c) => {
      const id = await criarConta(c);
      await falha(c, "select pagar_conta($1, '2026-11-12', 'a_receber')", [id], "23514");
      await c.query("select pagar_conta($1, '2026-11-12', 'pix')", [id]);
      expect(await conta(c, id)).toMatchObject({
        status: "paga",
        pago_em: "2026-11-12",
        forma: "pix",
      });
      expect((await falha(c, "select pagar_conta($1, '2026-11-13', 'pix')", [id])).message).toBe(
        MSG_PAGA,
      );
      expect(
        (
          await falha(c, "select editar_conta_pagar($1, 'Y', 'outros', null, 1, '2026-11-20', null)", [
            id,
          ])
        ).message,
      ).toBe(MSG_PAGA);
      expect((await falha(c, "select cancelar_conta_pagar($1, 'erro')", [id])).message).toBe(
        MSG_PAGA,
      );
    });
  });

  it("cancelar exige motivo (vazio, espaços ou nulo) e grava quem/quando", async () => {
    await comoUsuario(dona, async (c) => {
      const id = await criarConta(c);
      for (const motivo of ["", "   ", null]) {
        expect(
          (await falha(c, "select cancelar_conta_pagar($1, $2)", [id, motivo])).message,
        ).toBe(MSG_MOTIVO);
      }
      await falha(c, "select cancelar_conta_pagar($1, $2)", [id, "x".repeat(201)], "23514");
      await c.query("select cancelar_conta_pagar($1, '  Lançada em dobro  ')", [id]);
      expect(await conta(c, id)).toMatchObject({
        status: "cancelada",
        cancelada_motivo: "Lançada em dobro",
        tem_cancelada_em: true,
        cancelada_por: donaId,
      });
      expect((await falha(c, "select pagar_conta($1, '2026-11-13', 'pix')", [id])).message).toBe(
        MSG_CANCELADA,
      );
      expect((await falha(c, "select cancelar_conta_pagar($1, 'de novo')", [id])).message).toBe(
        MSG_CANCELADA,
      );
      expect(
        (
          await falha(c, "select editar_conta_pagar($1, 'Y', 'outros', null, 1, '2026-11-20', null)", [
            id,
          ])
        ).message,
      ).toBe(MSG_CANCELADA);
    });
  });

  it("editar conta aberta troca os campos", async () => {
    await comoUsuario(dona, async (c) => {
      const id = await criarConta(c);
      await c.query(
        "select editar_conta_pagar($1, ' Água ', 'imposto', '  ', 9900, '2026-12-05', null)",
        [id],
      );
      expect(await conta(c, id)).toMatchObject({
        descricao: "Água",
        categoria: "imposto",
        valor_centavos: 9900,
        vencimento: "2026-12-05",
        status: "aberta",
      });
      const f = await c.query("select fornecedor from contas_pagar where id = $1", [id]);
      expect(f.rows[0].fornecedor).toBeNull();
    });
  });
});

describe("anexo", () => {
  it("aceita caminho do bucket já enviado; recusa caminho fora do padrão ou inexistente", async () => {
    await comoUsuario(dona, async (c) => {
      const caminho = anexo("jpg");
      await c.query(SQL_OBJ, [caminho]);
      const id = await criarConta(c, { anexo: caminho });
      expect((await conta(c, id)).anexo_path).toBe(caminho);
      await falha(c, SQL_CRIAR, criarParams({ anexo: "contas_pagar/x.pdf" }), "23514");
      await falha(c, SQL_CRIAR, criarParams({ anexo: `outra/${randomUUID()}.pdf` }), "23514");
      await falha(c, SQL_CRIAR, criarParams({ anexo: `contas_pagar/${randomUUID()}.gif` }), "23514");
      const e = await falha(c, SQL_CRIAR, criarParams({ anexo: anexo() }));
      expect(e.message).toBe("Anexo não encontrado. Envie o arquivo de novo.");
    });
  });
});

describe("lançar vale", () => {
  it("cria conta paga, categoria vale, ligada à colaboradora", async () => {
    await comoUsuario(dona, async (c) => {
      const id = (
        await c.query<{ id: string }>(
          "select lancar_vale($1, 5000, '2026-11-10', 'dinheiro', ' adiantamento ') as id",
          [profId],
        )
      ).rows[0].id;
      expect(await conta(c, id)).toMatchObject({
        status: "paga",
        categoria: "vale",
        colaborador_id: profId,
        descricao: "Vale — Ana Lima · adiantamento",
        valor_centavos: 5000,
        vencimento: "2026-11-10",
        pago_em: "2026-11-10",
        forma: "dinheiro",
        lancada_por: donaId,
      });
      const semObs = (
        await c.query<{ id: string }>(
          "select lancar_vale($1, 3000, '2026-11-11', 'pix', null) as id",
          [profId],
        )
      ).rows[0].id;
      expect((await conta(c, semObs)).descricao).toBe("Vale — Ana Lima");
      await falha(c, "select lancar_vale($1, 3000, '2026-11-11', 'a_receber', null)", [profId], "23514");
      expect(
        (await falha(c, "select lancar_vale($1, 3000, '2026-11-11', 'pix', null)", [randomUUID()]))
          .message,
      ).toBe("Colaboradora não encontrada.");
    });
  });

  it("colaboradora inativa → 'Colaboradora não encontrada.'", async () => {
    const { colaboradorId: inativa } = await criarUsuario("profissional", { ativo: false });
    await comoUsuario(dona, async (c) => {
      expect(
        (await falha(c, "select lancar_vale($1, 3000, '2026-11-11', 'pix', null)", [inativa]))
          .message,
      ).toBe("Colaboradora não encontrada.");
    });
  });
});

describe("contas fixas", () => {
  const SQL_FIXA = "select criar_conta_fixa($1, 'aluguel', 'Imobiliária', 250000, $2, $3) as id";

  it("dia 31 de nov/2026 até jan/2027 cria 3 contas; a segunda chamada cria 0", async () => {
    await comoUsuario(dona, async (c) => {
      const fixa = (await c.query<{ id: string }>(SQL_FIXA, ["Aluguel", 31, "2026-11-15"])).rows[0]
        .id;
      const inativa = (await c.query<{ id: string }>(SQL_FIXA, ["Antiga", 5, "2026-01-01"])).rows[0]
        .id;
      await c.query("select desativar_conta_fixa($1)", [inativa]);
      const ini = await c.query("select inicio::text, ativa from contas_fixas where id = $1", [fixa]);
      expect(ini.rows[0]).toEqual({ inicio: "2026-11-01", ativa: true });

      const r = await c.query("select gerar_contas_fixas('2027-01-31') as n");
      expect(r.rows[0].n).toBe(3);
      const contas = await c.query(
        `select competencia::text, vencimento::text, status, categoria, valor_centavos,
                descricao, fornecedor, conta_fixa_id
         from contas_pagar order by competencia`,
      );
      expect(contas.rows).toEqual(
        [
          ["2026-11-01", "2026-11-30"],
          ["2026-12-01", "2026-12-31"],
          ["2027-01-01", "2027-01-31"],
        ].map(([competencia, vencimento]) => ({
          competencia,
          vencimento,
          status: "aberta",
          categoria: "aluguel",
          valor_centavos: 250000,
          descricao: "Aluguel",
          fornecedor: "Imobiliária",
          conta_fixa_id: fixa,
        })),
      );
      expect((await c.query("select gerar_contas_fixas('2027-01-31') as n")).rows[0].n).toBe(0);
      expect((await c.query("select gerar_contas_fixas('2027-01-01') as n")).rows[0].n).toBe(0);
    });
  });

  it("virada de ano: gerar em dez cria dezembro e janeiro uma vez só", async () => {
    await comoUsuario(dona, async (c) => {
      await c.query(SQL_FIXA, ["Aluguel", 10, "2026-12-01"]);
      expect((await c.query("select gerar_contas_fixas('2027-01-31') as n")).rows[0].n).toBe(2);
      expect((await c.query("select gerar_contas_fixas('2027-01-31') as n")).rows[0].n).toBe(0);
      const v = await c.query("select vencimento::text from contas_pagar order by vencimento");
      expect(v.rows.map((x) => x.vencimento)).toEqual(["2026-12-10", "2027-01-10"]);
    });
  });

  it("fixa iniciada em fev/2027 com dia 31 vence em 2027-02-28", async () => {
    await comoUsuario(dona, async (c) => {
      await c.query(SQL_FIXA, ["Aluguel", 31, "2027-02-01"]);
      expect((await c.query("select gerar_contas_fixas('2027-02-10') as n")).rows[0].n).toBe(1);
      const v = await c.query("select vencimento::text, competencia::text from contas_pagar");
      expect(v.rows).toEqual([{ vencimento: "2027-02-28", competencia: "2027-02-01" }]);
      expect((await c.query("select gerar_contas_fixas('2027-01-31') as n")).rows[0].n).toBe(0);
    });
  });

  it("valida dia 1–31, valor > 0 e categoria vale (23514)", async () => {
    await comoUsuario(dona, async (c) => {
      await falha(c, SQL_FIXA, ["Aluguel", 0, "2026-11-01"], "23514");
      await falha(c, SQL_FIXA, ["Aluguel", 32, "2026-11-01"], "23514");
      await falha(
        c,
        "select criar_conta_fixa('X', 'outros', null, 0, 10, '2026-11-01')",
        [],
        "23514",
      );
      await falha(
        c,
        "select criar_conta_fixa('X', 'vale', null, 100, 10, '2026-11-01')",
        [],
        "23514",
      );
      expect(
        (await falha(c, "select desativar_conta_fixa($1)", [randomUUID()])).message,
      ).toBe("Conta fixa não encontrada.");
    });
  });
});

describe("bucket financeiro (Storage)", () => {
  it("é privado, 5 MB, JPEG/PNG/PDF", async () => {
    const r = await comoSuperusuario((c) =>
      c.query(
        "select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'financeiro'",
      ),
    );
    expect(r.rows).toEqual([
      {
        public: false,
        file_size_limit: "5242880",
        allowed_mime_types: ["image/jpeg", "image/png", "application/pdf"],
      },
    ]);
  });

  it("só a dona envia e lê; caminho fora do padrão é negado", async () => {
    await comoUsuario(dona, async (c) => {
      for (const ext of ["jpg", "png", "pdf"]) await c.query(SQL_OBJ, [anexo(ext)]);
      expect(await contar(c, "storage.objects")).toBe(3);
      await falha(c, SQL_OBJ, [`contas_pagar/${randomUUID()}.gif`], "42501");
      await falha(c, SQL_OBJ, ["contas_pagar/nao-e-uuid.pdf"], "42501");
      await falha(c, SQL_OBJ, [`outra/${randomUUID()}.pdf`], "42501");
      for (const uid of [recepcao, prof]) {
        await logarComo(c, uid);
        expect(await contar(c, "storage.objects")).toBe(0);
        await falha(c, SQL_OBJ, [anexo()], "42501");
      }
    });
    await comoUsuario(null, (c) => esperarErroSql(c.query(SQL_OBJ, [anexo()]), "42501"));
  });
});

// =============================================================================
// 0010 (seções 4–5): contas a receber manuais, recebimentos e fechar_caixa.
// "Hoje" é a data de São Paulo do próprio banco; now() é fixo na transação.
// =============================================================================

const MSG_RECEBIDA = "Esta parcela já foi recebida.";
const MSG_ABRA = "Abra o caixa do dia antes de receber.";
const SQL_CRIAR_REC = "select criar_conta_receber($1, $2, $3, $4::date) as id";
const SQL_RECEBER = "select receber_parcela($1, $2) as id";
const SQL_HOJE = "(now() at time zone 'America/Sao_Paulo')::date";

describe("contas a receber e recebimentos", () => {
  let cli: string;

  beforeAll(async () => {
    cli = await comoSuperusuario(
      async (c) =>
        (
          await c.query<{ id: string }>(
            "insert into clientes (nome, aceite_lgpd_em) values ('Maria Souza', now()) returning id",
          )
        ).rows[0].id,
    );
  });

  /** Dona lança uma conta manual vencendo hoje + `dias`. */
  async function criarReceber(c: PoolClient, dias = 0, valor = 5000): Promise<string> {
    const venc = (
      await c.query<{ d: string }>(`select (${SQL_HOJE} + $1::int)::text as d`, [dias])
    ).rows[0].d;
    return (
      await c.query<{ id: string }>(SQL_CRIAR_REC, [cli, "Saldo do tratamento", valor, venc])
    ).rows[0].id;
  }

  async function receber(c: PoolClient, conta: string, forma = "pix"): Promise<string> {
    return (await c.query<{ id: string }>(SQL_RECEBER, [conta, forma])).rows[0].id;
  }

  it("dona lança conta manual (parcela 1/1, sem pagamento); descrição é obrigatória", async () => {
    await comoUsuario(dona, async (c) => {
      const id = (
        await c.query<{ id: string }>(SQL_CRIAR_REC, [cli, "  Saldo  ", 12000, "2026-12-01"])
      ).rows[0].id;
      const r = await c.query(
        `select cliente_id, descricao, valor_centavos, vencimento::text, numero, total_parcelas,
                origem_manual, pagamento_id, recebido_em, lancada_por, cancelada_em
         from contas_receber where id = $1`,
        [id],
      );
      expect(r.rows[0]).toEqual({
        cliente_id: cli,
        descricao: "Saldo",
        valor_centavos: 12000,
        vencimento: "2026-12-01",
        numero: 1,
        total_parcelas: 1,
        origem_manual: true,
        pagamento_id: null,
        recebido_em: null,
        lancada_por: donaId,
        cancelada_em: null,
      });
      for (const descricao of [null, "", "   ", "x".repeat(121)]) {
        await falha(c, SQL_CRIAR_REC, [cli, descricao, 100, "2026-12-01"], "23514");
      }
      await falha(c, SQL_CRIAR_REC, [cli, "X", 0, "2026-12-01"], "23514");
    });
    for (const uid of [recepcao, prof]) {
      await comoUsuario(uid, async (c) => {
        const e = await falha(c, SQL_CRIAR_REC, [cli, "X", 100, "2026-12-01"]);
        expect(e.message).toBe(MSG_DONA);
        expect((await falha(c, "select cancelar_conta_receber($1, 'x')", [randomUUID()])).message)
          .toBe(MSG_DONA);
      });
    }
  });

  it("receber sem caixa de hoje aberto → mensagem", async () => {
    await comoUsuario(dona, async (c) => {
      const id = await criarReceber(c);
      expect((await falha(c, SQL_RECEBER, [id, "pix"])).message).toBe(MSG_ABRA);
      const caixa = (await c.query<{ id: string }>("select abrir_caixa(0) as id")).rows[0].id;
      await c.query("select fechar_caixa($1, 0)", [caixa]);
      expect((await falha(c, SQL_RECEBER, [id, "pix"])).message).toBe(MSG_ABRA);
    });
  });

  it("cancelar: exige motivo, só em aberto; cancelada não é recebida", async () => {
    await comoUsuario(dona, async (c) => {
      await c.query("select abrir_caixa(0)");
      const id = await criarReceber(c);
      for (const motivo of ["", "  ", null]) {
        expect((await falha(c, "select cancelar_conta_receber($1, $2)", [id, motivo])).message)
          .toBe(MSG_MOTIVO);
      }
      await falha(c, "select cancelar_conta_receber($1, $2)", [id, "x".repeat(201)], "23514");
      await c.query("select cancelar_conta_receber($1, ' Cliente desistiu ')", [id]);
      const r = await c.query(
        `select cancelada_motivo, cancelada_em is not null as tem_em, cancelada_por
         from contas_receber where id = $1`,
        [id],
      );
      expect(r.rows[0]).toEqual({
        cancelada_motivo: "Cliente desistiu",
        tem_em: true,
        cancelada_por: donaId,
      });
      expect((await falha(c, SQL_RECEBER, [id, "pix"])).message).toBe(MSG_CANCELADA);
      expect((await falha(c, "select cancelar_conta_receber($1, 'de novo')", [id])).message).toBe(
        MSG_CANCELADA,
      );
      const recebida = await criarReceber(c);
      await receber(c, recebida);
      expect(
        (await falha(c, "select cancelar_conta_receber($1, 'erro')", [recebida])).message,
      ).toBe(MSG_RECEBIDA);
      expect((await falha(c, SQL_RECEBER, [randomUUID(), "pix"])).message).toBe(
        "Conta não encontrada.",
      );
    });
  });

  it("recepção recebe no caixa do dia e vê a parcela; não vê a de amanhã; profissional nada", async () => {
    await comoUsuario(dona, async (c) => {
      const hoje = await criarReceber(c, 0, 5000);
      const ontem = await criarReceber(c, -1, 3000);
      const amanha = await criarReceber(c, 1);
      const cancelada = await criarReceber(c, -2);
      await c.query("select cancelar_conta_receber($1, 'erro')", [cancelada]);
      expect(await contar(c, "contas_receber")).toBe(4);

      await logarComo(c, recepcao);
      const caixa = (await c.query<{ id: string }>("select abrir_caixa(0) as id")).rows[0].id;
      const visiveis = async () =>
        (await c.query<{ id: string }>("select id from contas_receber order by vencimento")).rows.map(
          (x) => x.id,
        );
      expect(await visiveis()).toEqual([ontem, hoje]);
      expect(await visiveis()).not.toContain(amanha);
      await falha(c, SQL_RECEBER, [hoje, "a_receber"], "23514");

      const rec = await receber(c, hoje, "dinheiro");
      const r = await c.query(
        `select conta_receber_id, caixa_id, forma, valor_centavos, recebido_por,
                recebido_em = now() as agora
         from recebimentos where id = $1`,
        [rec],
      );
      expect(r.rows).toEqual([
        {
          conta_receber_id: hoje,
          caixa_id: caixa,
          forma: "dinheiro",
          valor_centavos: 5000,
          recebido_por: recepcaoIdAtual,
          agora: true,
        },
      ]);
      expect(await visiveis()).toEqual([ontem, hoje]);
      const conta = await c.query("select recebido_em = now() as agora from contas_receber where id = $1", [
        hoje,
      ]);
      expect(conta.rows[0].agora).toBe(true);
      expect((await falha(c, SQL_RECEBER, [hoje, "pix"])).message).toBe(MSG_RECEBIDA);

      await logarComo(c, prof);
      expect(await contar(c, "contas_receber")).toBe(0);
      expect(await contar(c, "recebimentos")).toBe(0);
      const e = await falha(c, SQL_RECEBER, [ontem, "pix"]);
      expect(e.message).toBe("Apenas a dona ou a recepção podem receber parcelas.");

      // Caixa fechado: a recepção deixa de ver o recebimento e a parcela recebida.
      await logarComo(c, recepcao);
      await c.query("select fechar_caixa($1, 5000)", [caixa]);
      expect(await contar(c, "recebimentos")).toBe(0);
      expect(await visiveis()).toEqual([ontem]);
      await logarComo(c, dona);
      expect(await contar(c, "recebimentos")).toBe(1);
    });
    await comoUsuario(null, (c) => esperarErroSql(c.query("select * from recebimentos"), "42501"));
  });

  it("recepção não recebe parcela que vence depois de hoje ('Conta não encontrada.')", async () => {
    await comoUsuario(dona, async (c) => {
      await c.query("select abrir_caixa(0)");
      const amanha = await criarReceber(c, 1);
      const hoje = await criarReceber(c, 0);
      await logarComo(c, recepcao);
      expect((await falha(c, SQL_RECEBER, [amanha, "pix"])).message).toBe("Conta não encontrada.");
      await receber(c, hoje);
      await logarComo(c, dona);
      await receber(c, amanha);
    });
  });

  it("authenticated não faz TRUNCATE em caixas, pagamentos e contas_receber (42501)", async () => {
    for (const uid of [dona, recepcao]) {
      await comoUsuario(uid, async (c) => {
        for (const t of ["caixas", "pagamentos", "contas_receber"]) {
          await falha(c, `truncate table ${t} cascade`, [], "42501");
        }
      });
    }
  });

  it("sem escrita direta em contas_receber e recebimentos (42501)", async () => {
    await comoUsuario(dona, async (c) => {
      await c.query("select abrir_caixa(0)");
      const id = await criarReceber(c);
      const rec = await receber(c, id);
      await falha(c, "update contas_receber set valor_centavos = 1 where id = $1", [id], "42501");
      await falha(c, "delete from contas_receber where id = $1", [id], "42501");
      await falha(c, "update recebimentos set valor_centavos = 1 where id = $1", [rec], "42501");
      await falha(c, "delete from recebimentos where id = $1", [rec], "42501");
      await falha(
        c,
        `insert into recebimentos (conta_receber_id, caixa_id, forma, valor_centavos, recebido_por)
         select $1, caixa_id, 'pix', 1, recebido_por from recebimentos where id = $2`,
        [id, rec],
        "42501",
      );
    });
  });

  it("fechar_caixa: pagamento pix 100,00 + recebimento pix 50,00 → pix 15000; a_receber não entra", async () => {
    const resumo = await comoUsuario(recepcao, async (c) => {
      const caixa = (await c.query<{ id: string }>("select abrir_caixa(1000) as id")).rows[0].id;
      const hoje = (await c.query<{ d: string }>(`select ${SQL_HOJE}::text as d`)).rows[0].d;
      const reg =
        "select registrar_pagamento($1, null, $2::forma_pagamento, $3, 0, 1, $4::date[], $5::int[]) as id";
      await c.query(reg, [cli, "pix", 10000, null, null]);
      const pag = (await c.query<{ id: string }>(reg, [cli, "a_receber", 5000, [hoje], [5000]]))
        .rows[0].id;
      const parcela = (
        await c.query<{ id: string; origem_manual: boolean; descricao: string | null }>(
          "select id, origem_manual, descricao from contas_receber where pagamento_id = $1",
          [pag],
        )
      ).rows[0];
      expect(parcela).toMatchObject({ origem_manual: false, descricao: null });
      await receber(c, parcela.id, "pix");
      return (await c.query<{ r: Record<string, unknown> }>("select fechar_caixa($1, 1000) as r", [caixa]))
        .rows[0].r;
    });
    expect(resumo).toEqual({
      total_por_forma: {
        pix: 15000,
        dinheiro: 0,
        debito: 0,
        credito: 0,
        credito_parcelado: 0,
        a_receber: 0,
      },
      total_geral: 15000,
      dinheiro_esperado: 1000,
      diferenca: 0,
    });
  });

  it("fechar_caixa: recebimento em dinheiro entra no dinheiro esperado", async () => {
    const resumo = await comoUsuario(dona, async (c) => {
      const caixa = (await c.query<{ id: string }>("select abrir_caixa(2000) as id")).rows[0].id;
      await receber(c, await criarReceber(c, -3, 4500), "dinheiro");
      await receber(c, await criarReceber(c, 0, 1500), "debito");
      return (await c.query<{ r: Record<string, number | object> }>("select fechar_caixa($1, 6000) as r", [caixa]))
        .rows[0].r;
    });
    expect(resumo).toMatchObject({
      total_por_forma: { dinheiro: 4500, debito: 1500, pix: 0, a_receber: 0 },
      total_geral: 6000,
      dinheiro_esperado: 6500,
      diferenca: -500,
    });
  });

  it("duas conexões recebendo a mesma parcela: uma ok, outra 'Esta parcela já foi recebida.'", async () => {
    const { conta, caixa } = await comoSuperusuario(async (c) => {
      await logarComo(c, dona);
      const caixa = (await c.query<{ id: string }>("select abrir_caixa(0) as id")).rows[0].id;
      const conta = await criarReceber(c);
      await c.query("reset role");
      return { conta, caixa };
    });
    const c1 = await abrirConexao(recepcao);
    const c2 = await abrirConexao(recepcao);
    try {
      await c1.query("begin");
      await c1.query(SQL_RECEBER, [conta, "pix"]);
      await c2.query("begin");
      const pid2 = (await c2.query<{ pid: number }>("select pg_backend_pid() as pid")).rows[0].pid;
      const segundo = c2.query(SQL_RECEBER, [conta, "dinheiro"]).then(
        () => null,
        (e: unknown) => e as { code?: string; message: string },
      );
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
      expect(erro).toMatchObject({ code: "P0001", message: MSG_RECEBIDA });
      await c2.query("rollback");
    } finally {
      c1.release();
      c2.release();
    }
    const r = await comoSuperusuario((c) =>
      c.query("select forma, valor_centavos from recebimentos where conta_receber_id = $1", [conta]),
    );
    expect(r.rows).toEqual([{ forma: "pix", valor_centavos: 5000 }]);
    // Limpa o caixa de hoje (confirmado) para não afetar outros testes.
    await comoSuperusuario(async (c) => {
      await c.query("delete from recebimentos where caixa_id = $1", [caixa]);
      await c.query("delete from contas_receber where id = $1", [conta]);
      await c.query("delete from caixas where id = $1", [caixa]);
    });
  });
});
