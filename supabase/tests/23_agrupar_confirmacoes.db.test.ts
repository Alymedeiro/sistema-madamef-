import type { PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { comoSuperusuario, comoUsuario, criarUsuario, fecharConexoes, resetarBanco } from "./helpers";

// 0023: uma confirmação/lembrete por cliente por dia; "1" confirma o dia todo.

const ZAP = "5511987650000";
let dona: string;
let profId: string;
let cli: string;
let servicos: string[] = [];

async function comoServico(c: PoolClient) {
  await c.query("set local role service_role");
  await c.query("select set_config('request.jwt.claims', $1, true)", [
    JSON.stringify({ role: "service_role" }),
  ]);
}

function emTeste<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  return comoUsuario(dona, async (c) => {
    await c.query("reset role");
    return fn(c);
  });
}

/** Agendamento pendente daqui a `dias` dias, na hora (UTC) dada. */
async function agendar(c: PoolClient, dias: number, horaUtc: number, servico: string) {
  const r = await c.query<{ id: string }>(
    `insert into agendamentos (cliente_id, profissional_id, servico_id, inicio, fim, status)
     values ($1, $2, $3,
       date_trunc('day', now()) + make_interval(days => $4, hours => $5),
       date_trunc('day', now()) + make_interval(days => $4, hours => $5, mins => 30),
       'pendente') returning id`,
    [cli, profId, servico, dias, horaUtc],
  );
  return r.rows[0].id;
}

async function confirmacaoDe(c: PoolClient, ag: string) {
  return (
    await c.query<{ id: string; status: string; cancelada_motivo: string | null }>(
      "select id, status::text, cancelada_motivo from fila_mensagens where agendamento_id = $1 and tipo = 'confirmacao'",
      [ag],
    )
  ).rows[0];
}

beforeAll(async () => {
  await resetarBanco();
  ({ uid: dona } = await criarUsuario("dona"));
  ({ colaboradorId: profId } = await criarUsuario("profissional", { nome: "Ana" }));
  await comoSuperusuario(async (c) => {
    cli = (
      await c.query<{ id: string }>(
        "insert into clientes (nome, whatsapp, aceite_lgpd_em) values ('Sueli', $1, now()) returning id",
        [ZAP],
      )
    ).rows[0].id;
    const cat = (await c.query<{ id: string }>("insert into categorias_servico (nome) values ('F') returning id")).rows[0].id;
    for (const nome of ["Limpeza", "Design", "Buço"]) {
      servicos.push(
        (
          await c.query<{ id: string }>(
            "insert into servicos (nome, categoria_id, duracao_min, preco_centavos) values ($1, $2, 30, 1000) returning id",
            [nome, cat],
          )
        ).rows[0].id,
      );
    }
  });
});

afterAll(fecharConexoes);

describe("confirmação agrupada por dia", () => {
  it("grupo traz os horários do mesmo dia em ordem; outro dia fica de fora", async () => {
    await emTeste(async (c) => {
      // 3 dias à frente, 14h/15h30/16h UTC (11h/12h30/13h em SP) e um no dia seguinte.
      const a1 = await agendar(c, 3, 14, servicos[0]);
      const a3 = await agendar(c, 3, 16, servicos[2]);
      const a2 = await agendar(c, 3, 15, servicos[1]);
      await agendar(c, 4, 14, servicos[0]);
      const f1 = await confirmacaoDe(c, a1);
      await comoServico(c);
      const g = await c.query("select * from grupo_mensagem_agenda($1)", [f1.id]);
      await c.query("reset role");
      expect(g.rows.map((r) => r.agendamento_id)).toEqual([a1, a2, a3]);
      expect(g.rows.map((r) => r.servico)).toEqual(["Limpeza", "Design", "Buço"]);
      expect(g.rows.every((r) => r.ja_enviada === false)).toBe(true);
    });
  });

  it("depois do envio: grava o grupo, cancela as outras do dia e elas ficam 'já enviadas'", async () => {
    await emTeste(async (c) => {
      const a1 = await agendar(c, 3, 14, servicos[0]);
      const a2 = await agendar(c, 3, 15, servicos[1]);
      const outroDia = await agendar(c, 4, 14, servicos[2]);
      const f1 = await confirmacaoDe(c, a1);
      const f2 = await confirmacaoDe(c, a2);
      await c.query(
        "update fila_mensagens set status = 'enviada', enviada_em = now(), texto = 'x' where id = $1",
        [f1.id],
      );
      await comoServico(c);
      await c.query("select registrar_grupo_envio($1, $2)", [f1.id, [a1, a2]]);
      const g2 = await c.query("select ja_enviada from grupo_mensagem_agenda($1)", [f2.id]);
      await c.query("reset role");
      expect(await confirmacaoDe(c, a2)).toMatchObject({
        status: "cancelada",
        cancelada_motivo: "Enviada junto com outra mensagem do mesmo dia",
      });
      expect((await confirmacaoDe(c, outroDia)).status).toBe("pendente");
      expect(g2.rows[0]?.ja_enviada).toBe(true);
    });
  });

  it("'1' confirma todos os horários pendentes daquele dia (e só daquele dia)", async () => {
    await emTeste(async (c) => {
      const a1 = await agendar(c, 3, 14, servicos[0]);
      const a2 = await agendar(c, 3, 15, servicos[1]);
      const a3 = await agendar(c, 3, 16, servicos[2]);
      const outroDia = await agendar(c, 4, 14, servicos[0]);
      await comoServico(c);
      await c.query("select registrar_recebida($1, '1', 'ext-dia-1')", [ZAP]);
      await c.query("reset role");
      const st = await c.query<{ id: string; status: string }>(
        "select id, status::text from agendamentos where id = any($1)",
        [[a1, a2, a3, outroDia]],
      );
      const por = Object.fromEntries(st.rows.map((r) => [r.id, r.status]));
      expect([por[a1], por[a2], por[a3]]).toEqual(["confirmado", "confirmado", "confirmado"]);
      expect(por[outroDia]).toBe("pendente");
    });
  });
});
