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

// 0018: mídia recebida do WhatsApp — colunas de mídia em mensagens_recebidas,
// registrar_recebida_midia (por cima de registrar_recebida, com o robô),
// gravar_midia_recebida (service_role) e o bucket privado whatsapp-midia.

const ZAP = "5511987654321";
const DESCONHECIDO = "5521999998888";
const MENU_INICIO = "Oi, Maria! 💕 Sou a assistente virtual";

let dona: string;
let recepcao: string;
let prof: string;
let cli: string;
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

async function logarComo(c: PoolClient, uid: string | null) {
  await c.query(uid === null ? "set local role anon" : "set local role authenticated");
  await c.query("select set_config('request.jwt.claims', $1, true)", [
    JSON.stringify(uid === null ? { role: "anon" } : { sub: uid, role: "authenticated" }),
  ]);
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

type Midia = {
  tipo?: string;
  url?: string;
  mime?: string | null;
  nome?: string | null;
  tamanho?: number | null;
  legenda?: string | null;
  telefone?: string;
  idExterno?: string;
};

const SQL_MIDIA =
  "select registrar_recebida_midia($1, $2, $3, $4, $5, $6, $7, $8) as id";

function argsMidia(m: Midia = {}) {
  seq += 1;
  return [
    m.telefone ?? ZAP,
    m.idExterno ?? `midia-${seq}`,
    m.tipo ?? "imagem",
    m.url ?? "https://exemplo.com/imagem.png",
    m.mime === undefined ? "image/jpeg" : m.mime,
    m.nome ?? null,
    m.tamanho ?? null,
    m.legenda ?? null,
  ];
}

async function receberMidia(c: PoolClient, m: Midia = {}): Promise<string> {
  await comoServico(c);
  const r = await c.query<{ id: string }>(SQL_MIDIA, argsMidia(m));
  await comoSuper(c);
  return r.rows[0].id;
}

async function linha(c: PoolClient, id: string) {
  return (
    await c.query<{
      texto: string;
      classificacao: string;
      cliente_id: string | null;
      midia_tipo: string | null;
      midia_url_origem: string | null;
      midia_path: string | null;
      midia_mime: string | null;
      midia_nome: string | null;
      midia_tamanho: number | null;
      midia_status: string | null;
      legenda: string | null;
    }>("select * from mensagens_recebidas where id = $1", [id])
  ).rows[0];
}

beforeAll(async () => {
  await resetarBanco();
  ({ uid: dona } = await criarUsuario("dona"));
  ({ uid: recepcao } = await criarUsuario("recepcao"));
  ({ uid: prof } = await criarUsuario("profissional"));
  await comoSuperusuario(async (c) => {
    await c.query(
      `insert into configuracoes_clinica (nome, endereco) values ('Madame Fé', 'Rua das Flores, 10')`,
    );
    cli = (
      await c.query<{ id: string }>(
        `insert into clientes (nome, whatsapp, aceite_lgpd_em)
         values ('Maria Silva', $1, now()) returning id`,
        [ZAP],
      )
    ).rows[0].id;
  });
});

afterAll(async () => {
  await fecharConexoes();
});

describe("colunas de mídia em mensagens_recebidas", () => {
  it("checks de tipo, status, legenda e coerência", async () => {
    await emTeste(async (c) => {
      const base =
        "insert into mensagens_recebidas (telefone, texto, id_externo, classificacao, midia_tipo, midia_status, legenda, midia_path) values ($1, '', $2, 'para_ler', $3, $4, $5, $6)";
      await falha(c, base, [ZAP, "c1", "gif", "pendente", null, null], "23514");
      await falha(c, base, [ZAP, "c2", "imagem", "baixando", null, null], "23514");
      await falha(c, base, [ZAP, "c3", "imagem", "pendente", "x".repeat(2001), null], "23514");
      // Mídia sem status, status sem mídia, legenda sem mídia.
      await falha(c, base, [ZAP, "c4", "imagem", null, null, null], "23514");
      await falha(c, base, [ZAP, "c5", null, "pendente", null, null], "23514");
      await falha(c, base, [ZAP, "c6", null, null, "oi", null], "23514");
      // Salva exige caminho.
      await falha(c, base, [ZAP, "c7", "imagem", "salva", null, null], "23514");
      await c.query(base, [ZAP, "c8", "documento", "salva", "x".repeat(2000), "2026/11/a.pdf"]);
      for (const tipo of ["imagem", "figurinha", "video", "audio", "documento"]) {
        await c.query(base, [ZAP, `t-${tipo}`, tipo, "pendente", null, null]);
      }
      // Texto comum continua sem mídia.
      await c.query(
        "insert into mensagens_recebidas (telefone, texto, id_externo, classificacao) values ($1, 'oi', 'c9', 'para_ler')",
        [ZAP],
      );
    });
  });
});

describe("registrar_recebida_midia", () => {
  it("grava a mídia pendente, texto vazio, para_ler e a cliente do telefone", async () => {
    await emTeste(async (c) => {
      const id = await receberMidia(c, {
        tipo: "documento",
        url: "https://exemplo.com/nota.pdf",
        mime: "application/pdf",
        nome: "nota.pdf",
        tamanho: 1234,
        legenda: "Segue a nota",
      });
      expect(await linha(c, id)).toMatchObject({
        texto: "",
        classificacao: "para_ler",
        cliente_id: cli,
        midia_tipo: "documento",
        midia_url_origem: "https://exemplo.com/nota.pdf",
        midia_path: null,
        midia_mime: "application/pdf",
        midia_nome: "nota.pdf",
        midia_tamanho: 1234,
        midia_status: "pendente",
        legenda: "Segue a nota",
      });
    });
  });

  it("legenda '1' não confirma agendamento (mídia é sempre para_ler)", async () => {
    await emTeste(async (c) => {
      const id = await receberMidia(c, { legenda: "1" });
      expect((await linha(c, id)).classificacao).toBe("para_ler");
    });
  });

  it("idempotente pelo id externo; legenda longa e nome são cortados", async () => {
    await emTeste(async (c) => {
      const a = await receberMidia(c, {
        idExterno: "rep-1",
        legenda: "x".repeat(3000),
        nome: "n".repeat(400),
      });
      const b = await receberMidia(c, { idExterno: "rep-1", tipo: "video" });
      expect(b).toBe(a);
      const l = await linha(c, a);
      expect(l.midia_tipo).toBe("imagem");
      expect(l.legenda).toHaveLength(2000);
      expect(l.midia_nome).toHaveLength(255);
      expect(
        (await c.query("select count(*)::int as n from mensagens_recebidas where id_externo = 'rep-1'"))
          .rows[0].n,
      ).toBe(1);
    });
  });

  it("tipo inválido, sem URL ou sem id → P0001", async () => {
    await emTeste(async (c) => {
      await comoServico(c);
      await falha(c, SQL_MIDIA, argsMidia({ tipo: "gif" }));
      await falha(c, SQL_MIDIA, argsMidia({ url: " " }));
      await falha(c, SQL_MIDIA, argsMidia({ idExterno: " " }));
    });
  });

  it("só o service_role executa", async () => {
    for (const uid of [dona, recepcao, prof, null]) {
      await comoUsuario(uid, async (c) => {
        await logarComo(c, uid);
        await esperarErroSql(c.query(SQL_MIDIA, argsMidia()), "42501");
      });
    }
  });

  it("robô: mídia sem texto é texto não reconhecido (menu, depois 'não entendi')", async () => {
    await emTeste(async (c) => {
      await c.query("update configuracoes_clinica set whatsapp_ativo = true");
      await c.query("update robo_config set ativo = true, quando = 'sempre'");
      // Na mesma transação criado_em é igual: compara pelos ids já vistos.
      const vistos = new Set<string>();
      const novos = async () => {
        const r = await c.query<{ id: string; texto: string }>(
          "select id, texto from fila_mensagens where tipo = 'robo' and telefone = $1",
          [DESCONHECIDO],
        );
        const n = r.rows.filter((x) => !vistos.has(x.id));
        n.forEach((x) => vistos.add(x.id));
        return n.map((x) => x.texto);
      };
      await receberMidia(c, { telefone: DESCONHECIDO });
      const primeiro = await novos();
      await receberMidia(c, { telefone: DESCONHECIDO, tipo: "audio", mime: "audio/ogg" });
      const textos = [...primeiro, ...(await novos())];
      expect(textos).toHaveLength(2);
      expect(textos[0]).toContain("Sou a assistente virtual");
      expect(textos[0]).not.toContain(MENU_INICIO); // sem cadastro: sem nome
      expect(textos[1]).toMatch(/^Não entendi/);
    });
  });
});

describe("gravar_midia_recebida", () => {
  const SQL = "select gravar_midia_recebida($1, $2, $3, $4, $5)";

  it("salva com caminho, mime e tamanho; falhou e grande_demais sem caminho", async () => {
    await emTeste(async (c) => {
      const id = await receberMidia(c, { mime: null });
      await comoServico(c);
      await c.query(SQL, [id, "salva", `2026/11/${id}.jpg`, "image/jpeg", 2048]);
      await comoSuper(c);
      expect(await linha(c, id)).toMatchObject({
        midia_status: "salva",
        midia_path: `2026/11/${id}.jpg`,
        midia_mime: "image/jpeg",
        midia_tamanho: 2048,
      });

      const id2 = await receberMidia(c, { mime: "video/mp4", tamanho: 10 });
      await comoServico(c);
      await c.query(SQL, [id2, "grande_demais", null, null, 20_000_000]);
      await comoSuper(c);
      expect(await linha(c, id2)).toMatchObject({
        midia_status: "grande_demais",
        midia_path: null,
        midia_mime: "video/mp4",
        midia_tamanho: 20_000_000,
      });

      const id3 = await receberMidia(c);
      await comoServico(c);
      await c.query(SQL, [id3, "falhou", null, null, null]);
      await comoSuper(c);
      expect((await linha(c, id3)).midia_status).toBe("falhou");
      // Depois de falhar, uma nova tentativa pode salvar.
      await comoServico(c);
      await c.query(SQL, [id3, "salva", `2026/11/${id3}.jpg`, null, null]);
      await comoSuper(c);
      expect((await linha(c, id3)).midia_status).toBe("salva");
    });
  });

  it("já salva não volta para falhou", async () => {
    await emTeste(async (c) => {
      const id = await receberMidia(c);
      await comoServico(c);
      await c.query(SQL, [id, "salva", `2026/11/${id}.jpg`, null, null]);
      await c.query(SQL, [id, "falhou", null, null, null]);
      await comoSuper(c);
      expect(await linha(c, id)).toMatchObject({
        midia_status: "salva",
        midia_path: `2026/11/${id}.jpg`,
      });
    });
  });

  it("status inválido, salva sem caminho válido, sem mídia ou inexistente → P0001", async () => {
    await emTeste(async (c) => {
      const id = await receberMidia(c);
      const texto = (
        await c.query<{ id: string }>(
          "insert into mensagens_recebidas (telefone, texto, id_externo, classificacao) values ($1, 'oi', 'sem-midia', 'para_ler') returning id",
          [ZAP],
        )
      ).rows[0].id;
      await comoServico(c);
      await falha(c, SQL, [id, "pendente", null, null, null]);
      await falha(c, SQL, [id, "salva", null, null, null]);
      await falha(c, SQL, [id, "salva", "../outro.jpg", null, null]);
      await falha(c, SQL, [id, "salva", `2026/11/outro.jpg`, null, null]);
      await falha(c, SQL, [texto, "falhou", null, null, null]);
      await falha(c, SQL, ["00000000-0000-4000-8000-000000000000", "falhou", null, null, null]);
    });
  });

  it("só o service_role executa", async () => {
    for (const uid of [dona, recepcao, prof, null]) {
      await comoUsuario(uid, async (c) => {
        await logarComo(c, uid);
        await esperarErroSql(
          c.query(SQL, ["00000000-0000-4000-8000-000000000000", "falhou", null, null, null]),
          "42501",
        );
      });
    }
  });
});

describe("bucket whatsapp-midia (Storage)", () => {
  const OBJ = "insert into storage.objects (bucket_id, name) values ('whatsapp-midia', $1)";
  const contarObjetos = async (c: PoolClient) =>
    (
      await c.query<{ n: number }>(
        "select count(*)::int as n from storage.objects where bucket_id = 'whatsapp-midia'",
      )
    ).rows[0].n;

  it("privado, 16 MB, sem restrição de tipo", async () => {
    await emTeste(async (c) => {
      expect(
        (
          await c.query(
            "select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'whatsapp-midia'",
          )
        ).rows,
      ).toEqual([{ public: false, file_size_limit: "16777216", allowed_mime_types: null }]);
    });
  });

  it("dona e recepção leem; profissional e anônimo não; ninguém do app grava", async () => {
    await comoUsuario(dona, async (c) => {
      await comoSuper(c);
      await c.query(OBJ, ["2026/11/a.jpg"]);
      await c.query(OBJ, ["2026/11/b.ogg"]);
      for (const [uid, n] of [
        [dona, 2],
        [recepcao, 2],
        [prof, 0],
        [null, 0],
      ] as const) {
        await logarComo(c, uid);
        expect(await contarObjetos(c)).toBe(n);
        await comoSuper(c);
      }
      for (const uid of [dona, recepcao, prof, null]) {
        await logarComo(c, uid);
        await falha(c, OBJ, ["2026/11/c.jpg"], "42501");
        expect((await c.query("update storage.objects set name = name || 'x' where bucket_id = 'whatsapp-midia'")).rowCount).toBe(0);
        expect((await c.query("delete from storage.objects where bucket_id = 'whatsapp-midia'")).rowCount).toBe(0);
        await comoSuper(c);
      }
      // O service_role (servidor) grava.
      await comoServico(c);
      await c.query(OBJ, ["2026/11/d.pdf"]);
      await comoSuper(c);
      expect(await contarObjetos(c)).toBe(3);
    });
  });
});
