import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  comoSuperusuario,
  comoUsuario,
  criarPacote,
  criarUsuario,
  esperarErroSql,
  fecharConexoes,
  resetarBanco,
} from "./helpers";

// 0021: excluir_servico — só a dona, só serviço sem histórico.

let dona: string;
let recepcao: string;
let profissionalId: string;
let categoria: string;
let cliente: string;

async function novoServico(nome: string): Promise<string> {
  return comoSuperusuario(async (c) => {
    const r = await c.query<{ id: string }>(
      `insert into servicos (nome, categoria_id, duracao_min, preco_centavos)
       values ($1, $2, 30, 5000) returning id`,
      [nome, categoria],
    );
    return r.rows[0].id;
  });
}

beforeAll(async () => {
  await resetarBanco();
  ({ uid: dona } = await criarUsuario("dona"));
  ({ uid: recepcao } = await criarUsuario("recepcao"));
  ({ colaboradorId: profissionalId } = await criarUsuario("profissional"));
  await comoSuperusuario(async (c) => {
    categoria = (
      await c.query<{ id: string }>("insert into categorias_servico (nome) values ('Facial') returning id")
    ).rows[0].id;
    cliente = (
      await c.query<{ id: string }>(
        "insert into clientes (nome, whatsapp, aceite_lgpd_em) values ('Ana', '5511912345678', now()) returning id",
      )
    ).rows[0].id;
  });
});

afterAll(fecharConexoes);

describe("excluir_servico", () => {
  it("dona exclui serviço sem histórico: vínculos saem e devolve os caminhos das fotos", async () => {
    const s = await novoServico("Cadastrado por engano");
    const foto = `servicos/${s}/${randomUUID()}.webp`;
    const lead = await comoSuperusuario(async (c) => {
      await c.query("insert into colaborador_servicos (colaborador_id, servico_id) values ($1, $2)", [
        profissionalId,
        s,
      ]);
      await c.query(
        "insert into servicos_fotos (servico_id, caminho, largura, altura) values ($1, $2, 10, 10)",
        [s, foto],
      );
      return (
        await c.query<{ id: string }>(
          "insert into leads (nome, whatsapp, servico_id) values ('Lead', '5511988887777', $1) returning id",
          [s],
        )
      ).rows[0].id;
    });

    await comoUsuario(dona, async (c) => {
      const r = await c.query<{ caminhos: string[] }>("select excluir_servico($1) as caminhos", [s]);
      expect(r.rows[0].caminhos).toEqual([foto]);
      // comoUsuario desfaz tudo no fim: confere aqui mesmo, como superusuário.
      await c.query("reset role");
      expect((await c.query("select 1 from servicos where id = $1", [s])).rowCount).toBe(0);
      expect((await c.query("select 1 from colaborador_servicos where servico_id = $1", [s])).rowCount).toBe(0);
      expect((await c.query("select 1 from servicos_fotos where servico_id = $1", [s])).rowCount).toBe(0);
      const l = await c.query("select servico_id from leads where id = $1", [lead]);
      expect(l.rows[0].servico_id).toBeNull();
    });
  });

  it("serviço com agendamento ou pacote é recusado com a mensagem", async () => {
    const comAgenda = await novoServico("Com agenda");
    const comPacote = await novoServico("Com pacote");
    await comoSuperusuario(async (c) => {
      await c.query(
        `insert into agendamentos (cliente_id, profissional_id, servico_id, inicio, fim)
         values ($1, $2, $3, now() + interval '1 day', now() + interval '1 day 30 minutes')`,
        [cliente, profissionalId, comAgenda],
      );
      await criarPacote(c, { clienteId: cliente, servicoId: comPacote });
    });
    for (const s of [comAgenda, comPacote]) {
      await comoUsuario(dona, async (c) => {
        const erro = await esperarErroSql(c.query("select excluir_servico($1)", [s]), "P0001");
        expect(erro.message).toMatch(/já tem histórico/);
      });
    }
    await comoSuperusuario(async (c) => {
      const r = await c.query("select 1 from servicos where id = any($1)", [[comAgenda, comPacote]]);
      expect(r.rowCount).toBe(2);
    });
  });

  it("recepção não exclui; id inexistente avisa", async () => {
    const s = await novoServico("Da recepção");
    await comoUsuario(recepcao, async (c) => {
      const erro = await esperarErroSql(c.query("select excluir_servico($1)", [s]), "P0001");
      expect(erro.message).toBe("Apenas a dona pode excluir serviços.");
    });
    await comoUsuario(dona, async (c) => {
      const erro = await esperarErroSql(c.query("select excluir_servico($1)", [randomUUID()]), "P0001");
      expect(erro.message).toBe("Serviço não encontrado.");
    });
  });
});
