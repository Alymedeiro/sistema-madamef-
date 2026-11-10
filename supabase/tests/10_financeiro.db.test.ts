import { randomUUID } from "node:crypto";
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

// 0010 (seções 1–3): contas a pagar, contas fixas, vale e o bucket `financeiro`.

const MSG_DONA = "Apenas a dona pode lançar contas.";
const MSG_PAGA = "Esta conta já foi paga.";
const MSG_CANCELADA = "Esta conta foi cancelada.";
const MSG_MOTIVO = "Informe o motivo do cancelamento.";

let dona: string;
let donaId: string;
let recepcao: string;
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
  recepcao = (await criarUsuario("recepcao")).uid;
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
