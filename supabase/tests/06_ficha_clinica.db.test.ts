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

// 0006: ficha clínica (anamneses, termos, fotos, evoluções), auditoria,
// bucket privado `ficha-clinica` e ajustes herdados da Fase 1.

let dona: string;
let donaId: string;
let recepcao: string;
let recepcaoId: string;
let profA: string; // vinculada a `cli`
let profAId: string;
let profB: string; // vinculada só a `cli2`
let profBId: string;

let cli: string;
let cli2: string;
let servicoId: string;
let servicoTermoId: string;
let termoV1: string;
let agDeA: string; // cli + profA
let agDeB: string; // cli2 + profB
let agTermo: string; // cli + profA, serviço com termo, atendido em 2030-07-10
let fotoId: string;

const uuidPath = () => randomUUID();
const foto = (cliente: string) => `clientes/${cliente}/fotos/${uuidPath()}.jpg`;
const png = (cliente: string, area: string) => `clientes/${cliente}/${area}/${uuidPath()}.png`;
const pdf = (cliente: string) => `clientes/${cliente}/termos/${uuidPath()}.pdf`;
const HASH = "a".repeat(64);
const SQL_OBJ = "insert into storage.objects (bucket_id, name) values ('ficha-clinica', $1)";

const q = (sql: string, params?: unknown[]) => comoSuperusuario((c) => c.query(sql, params));

const RESPOSTAS_NAO = {
  queixa: "Manchas",
  alergias: { sim: false },
  gestante: false,
  medicamentos: { sim: false },
  anticoagulante: false,
};

// 0008: anamnese e termo só gravam com os arquivos já no bucket (o servidor
// envia antes de inserir); os atalhos gravam os objetos antes, como superusuário.
async function insertAnamnese(
  cliente: string,
  o: { pathDe?: string; respostas?: object } = {},
) {
  const assinatura = png(o.pathDe ?? cliente, "anamneses");
  await q(SQL_OBJ, [assinatura]);
  return {
    text: `insert into anamneses (cliente_id, modelo_id, modelo_versao, respostas, assinatura_path)
           select $1, id, versao, $2::jsonb, $3 from modelos_anamnese where ativo
           returning id`,
    values: [
      cliente,
      JSON.stringify(o.respostas ?? RESPOSTAS_NAO),
      assinatura,
    ],
  };
}

function insertEvolucao(ag: string, cliente: string, texto = "Pele reagiu bem") {
  return {
    text: "insert into evolucoes (cliente_id, agendamento_id, texto) values ($1, $2, $3) returning id",
    values: [cliente, ag, texto],
  };
}

async function insertTermo(
  cliente: string,
  modelo: string,
  o: { pdfDe?: string; hash?: string } = {},
) {
  const assinatura = png(cliente, "termos");
  const arquivo = pdf(o.pdfDe ?? cliente);
  for (const n of [assinatura, arquivo]) await q(SQL_OBJ, [n]);
  return {
    text: `insert into termos_assinados
             (cliente_id, modelo_termo_id, modelo_versao, assinatura_path, pdf_path, hash_sha256, dispositivo)
           values ($1, $2, $3, $4, $5, $6, 'iPad') returning id`,
    values: [cliente, modelo, 1, assinatura, arquivo, o.hash ?? HASH],
  };
}

const insertAuditoria = () => ({
  text: "insert into auditoria (acao, entidade, cliente_id) values ('visualizou', 'anamneses', $1)",
  values: [cli],
});

// Volta a ser superusuário dentro da transação do usuário (para conferir).
async function comoSuper(c: PoolClient) {
  await c.query("reset role");
}

async function idsDe(c: PoolClient, sql: string, params: unknown[]) {
  return (await c.query<{ id: string }>(sql, params)).rows.map((l) => l.id);
}

beforeAll(async () => {
  await resetarBanco();
  ({ uid: dona, colaboradorId: donaId } = await criarUsuario("dona"));
  ({ uid: recepcao, colaboradorId: recepcaoId } = await criarUsuario("recepcao"));
  ({ uid: profA, colaboradorId: profAId } = await criarUsuario("profissional"));
  ({ uid: profB, colaboradorId: profBId } = await criarUsuario("profissional"));

  await comoSuperusuario(async (c) => {
    const id = async (sql: string, p: unknown[] = []) =>
      (await c.query<{ id: string }>(sql, p)).rows[0].id;
    cli = await id("insert into clientes (nome, aceite_lgpd_em) values ('Cli', now()) returning id");
    cli2 = await id("insert into clientes (nome, aceite_lgpd_em) values ('Cli 2', now()) returning id");
    const cat = await id("insert into categorias_servico (nome) values ('Facial') returning id");
    termoV1 = await id("select id from modelos_termo where ativo");
    servicoId = await id(
      `insert into servicos (nome, categoria_id, duracao_min) values ('Limpeza', $1, 60) returning id`,
      [cat],
    );
    servicoTermoId = await id(
      `insert into servicos (nome, categoria_id, duracao_min, modelo_termo_id)
       values ('Peeling', $1, 60, $2) returning id`,
      [cat, termoV1],
    );
    const ag = (cliente: string, prof: string, serv: string, dia: string, status: string) =>
      id(
        `insert into agendamentos (cliente_id, profissional_id, servico_id, inicio, fim, status)
         values ($1, $2, $3, $4::timestamptz, $4::timestamptz + interval '1 hour', $5) returning id`,
        [cliente, prof, serv, `${dia}T10:00:00-03:00`, status],
      );
    agDeA = await ag(cli, profAId, servicoId, "2030-07-01", "confirmado");
    agDeB = await ag(cli2, profBId, servicoId, "2030-07-01", "confirmado");
    agTermo = await ag(cli, profAId, servicoTermoId, "2030-07-10", "atendido");

    // 1 foto, 1 termo (PDF) e 1 anamnese (assinatura) de `cli`, no Storage e nas tabelas.
    const fotoPath = foto(cli);
    const anamPath = png(cli, "anamneses");
    const termoPdf = pdf(cli);
    for (const n of [fotoPath, anamPath, termoPdf]) await c.query(SQL_OBJ, [n]);
    await c.query(
      `insert into anamneses (cliente_id, modelo_id, modelo_versao, respostas, assinatura_path, preenchida_por, preenchida_em)
       select $1, id, versao, $2::jsonb, $3, $4, now() - interval '1 day' from modelos_anamnese where ativo`,
      [cli, JSON.stringify(RESPOSTAS_NAO), anamPath, recepcaoId],
    );
    fotoId = await id(
      `insert into fotos (cliente_id, agendamento_id, tipo, path, enviada_por)
       values ($1, $2, 'antes', $3, $4) returning id`,
      [cli, agDeA, fotoPath, profAId],
    );
  });
});

afterAll(fecharConexoes);

describe("bucket ficha-clinica (Storage)", () => {
  it("é privado, 5 MB, JPEG/PNG/PDF", async () => {
    expect(
      (await q("select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'ficha-clinica'")).rows,
    ).toEqual([
      {
        public: false,
        file_size_limit: "5242880",
        allowed_mime_types: ["image/jpeg", "image/png", "application/pdf"],
      },
    ]);
  });

  it("profissional vinculada envia foto; dona envia de qualquer cliente", async () => {
    await comoUsuario(profA, (c) => c.query(SQL_OBJ, [foto(cli)]));
    await comoUsuario(dona, (c) => c.query(SQL_OBJ, [foto(cli2)]));
  });

  it("caminho de outra cliente, adulterado ou fora de fotos/ é negado com 42501", async () => {
    await comoUsuario(profA, (c) => esperarErroSql(c.query(SQL_OBJ, [foto(cli2)]), "42501"));
    await comoUsuario(recepcao, (c) => esperarErroSql(c.query(SQL_OBJ, [foto(cli)]), "42501"));
    await comoUsuario(profA, (c) => esperarErroSql(c.query(SQL_OBJ, [pdf(cli)]), "42501"));
    await comoUsuario(profA, (c) =>
      esperarErroSql(c.query(SQL_OBJ, [png(cli, "anamneses")]), "42501"),
    );
    await comoUsuario(profA, (c) =>
      esperarErroSql(c.query(SQL_OBJ, ["clientes/nao-e-uuid/fotos/x.jpg"]), "42501"),
    );
    await comoUsuario(profA, (c) =>
      esperarErroSql(
        c.query(SQL_OBJ, [`clientes/${cli}/fotos/../../${cli2}/fotos/${randomUUID()}.jpg`]),
        "42501",
      ),
    );
    // Extensão errada na pasta de fotos.
    await comoUsuario(profA, (c) =>
      esperarErroSql(c.query(SQL_OBJ, [`clientes/${cli}/fotos/${randomUUID()}.pdf`]), "42501"),
    );
    // Outro bucket.
    await comoUsuario(dona, (c) =>
      esperarErroSql(
        c.query("insert into storage.objects (bucket_id, name) values ('outro', $1)", [foto(cli)]),
        "42501",
      ),
    );
    await comoUsuario(null, (c) => esperarErroSql(c.query(SQL_OBJ, [foto(cli)]), "42501"));
  });

  it("leitura por perfil; ninguém apaga", async () => {
    expect(await comoUsuario(dona, (c) => contar(c, "storage.objects"))).toBe(3);
    expect(await comoUsuario(recepcao, (c) => contar(c, "storage.objects"))).toBe(2);
    expect(await comoUsuario(profA, (c) => contar(c, "storage.objects"))).toBe(3);
    expect(await comoUsuario(profB, (c) => contar(c, "storage.objects"))).toBe(0);
    expect(await comoUsuario(null, (c) => contar(c, "storage.objects"))).toBe(0);
    expect((await comoUsuario(dona, (c) => c.query("delete from storage.objects"))).rowCount).toBe(0);
    expect(
      (await comoUsuario(dona, (c) => c.query("update storage.objects set name = name || 'x'"))).rowCount,
    ).toBe(0);
  });

  it("cliente_do_caminho / area_do_caminho nunca estouram com texto inválido", async () => {
    const r = await q(
      `select cliente_do_caminho(n) as cliente, area_do_caminho(n) as area
       from unnest($1::text[]) n`,
      [[`clientes/${cli}/fotos/${fotoId}.jpg`, "clientes/nao-e-uuid/fotos/x.jpg", "x", `clientes/${cli}/outra/${fotoId}.jpg`]],
    );
    expect(r.rows).toEqual([
      { cliente: cli, area: "fotos" },
      { cliente: null, area: null },
      { cliente: null, area: null },
      { cliente: null, area: null },
    ]);
  });
});

describe("anamneses", () => {
  it("visibilidade por perfil", async () => {
    expect(await comoUsuario(dona, (c) => contar(c, "anamneses"))).toBe(1);
    expect(await comoUsuario(recepcao, (c) => contar(c, "anamneses"))).toBe(1);
    expect(await comoUsuario(profA, (c) => contar(c, "anamneses"))).toBe(1);
    expect(await comoUsuario(profB, (c) => contar(c, "anamneses"))).toBe(0);
    await comoUsuario(null, (c) => esperarErroSql(contar(c, "anamneses"), "42501"));
  });

  it("recepção aplica; profissional não; caminho de outra cliente viola o check", async () => {
    await comoUsuario(recepcao, async (c) => c.query(await insertAnamnese(cli)));
    await comoUsuario(profA, async (c) => esperarErroSql(c.query(await insertAnamnese(cli)), "42501"));
    await comoUsuario(recepcao, async (c) =>
      esperarErroSql(c.query(await insertAnamnese(cli, { pathDe: cli2 })), "23514"),
    );
  });

  it("ninguém apaga nem altera (sem privilégio de delete)", async () => {
    await comoUsuario(dona, (c) => esperarErroSql(c.query("delete from anamneses"), "42501"));
    expect(
      (await comoUsuario(dona, (c) => c.query("update anamneses set respostas = '{}'"))).rowCount,
    ).toBe(0);
  });
});

describe("termos assinados", () => {
  it("dona, recepção e profissional vinculada colhem; sem vínculo não", async () => {
    for (const uid of [dona, recepcao, profA]) {
      await comoUsuario(uid, async (c) => c.query(await insertTermo(cli, termoV1)));
    }
    await comoUsuario(profB, async (c) => esperarErroSql(c.query(await insertTermo(cli, termoV1)), "42501"));
  });

  it("hash e caminhos são conferidos", async () => {
    await comoUsuario(dona, async (c) => {
      await esperarErroSql(c.query(await insertTermo(cli, termoV1, { hash: "XYZ" })), "23514");
    });
    await comoUsuario(dona, async (c) => {
      await esperarErroSql(c.query(await insertTermo(cli, termoV1, { pdfDe: cli2 })), "23514");
    });
  });
});

describe("evoluções", () => {
  it("profissional registra no próprio atendimento; outros não", async () => {
    await comoUsuario(profA, (c) => c.query(insertEvolucao(agDeA, cli)));
    await comoUsuario(profA, (c) => esperarErroSql(c.query(insertEvolucao(agDeB, cli2)), "42501"));
    // Atendimento dela, mas de outra cliente (0008: o gatilho recusa antes da política).
    const outra = await comoUsuario(profA, (c) =>
      esperarErroSql(c.query(insertEvolucao(agDeA, cli2)), "P0001"),
    );
    expect(outra.message).toBe("O atendimento é de outra cliente.");
    await comoUsuario(recepcao, (c) => esperarErroSql(c.query(insertEvolucao(agDeA, cli)), "42501"));
    await comoUsuario(profA, (c) => esperarErroSql(c.query(insertEvolucao(agDeA, cli, " ")), "23514"));
  });

  async function evolucaoDeA(horasAtras: number): Promise<string> {
    const r = await q(
      `insert into evolucoes (cliente_id, agendamento_id, profissional_id, texto, criado_em)
       values ($1, $2, $3, 'Original', now() - make_interval(hours => $4)) returning id`,
      [cli, agDeA, profAId, horasAtras],
    );
    return r.rows[0].id;
  }
  const updateTexto = (ev: string) => ({
    text: "update evolucoes set texto = 'Corrigido' where id = $1",
    values: [ev],
  });

  it("autora edita o texto em até 24 horas", async () => {
    const ev = await evolucaoDeA(1);
    expect((await comoUsuario(profA, (c) => c.query(updateTexto(ev)))).rowCount).toBe(1);
    expect((await comoUsuario(profB, (c) => c.query(updateTexto(ev)))).rowCount).toBe(0);
    expect((await comoUsuario(dona, (c) => c.query(updateTexto(ev)))).rowCount).toBe(0);
    const e = await comoUsuario(profA, (c) =>
      esperarErroSql(c.query("update evolucoes set agendamento_id = $2 where id = $1", [ev, agTermo]), "P0001"),
    );
    expect(e.message).toBe("A evolução só pode ser editada pela autora em até 24 horas");
  });

  it("depois de 24 horas, não", async () => {
    const ev = await evolucaoDeA(25);
    const e = await comoUsuario(profA, (c) => esperarErroSql(c.query(updateTexto(ev)), "P0001"));
    expect(e.message).toBe("A evolução só pode ser editada pela autora em até 24 horas");
  });

  it("visibilidade: profissional sem vínculo não vê", async () => {
    await evolucaoDeA(2);
    expect(await comoUsuario(recepcao, (c) => contar(c, "evolucoes"))).toBeGreaterThan(0);
    expect(await comoUsuario(profB, (c) => contar(c, "evolucoes"))).toBe(0);
  });
});

describe("fotos", () => {
  it("recepção não vê fotos; profissional vinculada e dona veem", async () => {
    expect(await comoUsuario(recepcao, (c) => contar(c, "fotos"))).toBe(0);
    expect(await comoUsuario(profA, (c) => contar(c, "fotos"))).toBe(1);
    expect(await comoUsuario(profB, (c) => contar(c, "fotos"))).toBe(0);
    expect(await comoUsuario(dona, (c) => contar(c, "fotos"))).toBe(1);
  });

  it("profissional vinculada adiciona; recepção não; caminho de outra cliente viola o check", async () => {
    const ins = (cliente: string, path: string) => ({
      text: "insert into fotos (cliente_id, tipo, path) values ($1, 'depois', $2)",
      values: [cliente, path],
    });
    await comoUsuario(profA, (c) => c.query(ins(cli, foto(cli))));
    await comoUsuario(recepcao, (c) => esperarErroSql(c.query(ins(cli, foto(cli))), "42501"));
    await comoUsuario(profA, (c) => esperarErroSql(c.query(ins(cli, foto(cli2))), "23514"));
  });

  it("só a dona arquiva, e só arquiva", async () => {
    expect((await comoUsuario(profA, (c) => c.query("update fotos set arquivada = true"))).rowCount).toBe(0);
    const e = await comoUsuario(dona, (c) =>
      esperarErroSql(c.query("update fotos set path = $1", [foto(cli)]), "P0001"),
    );
    expect(e.message).toBe("Fotos só podem ser arquivadas");
    await comoUsuario(dona, async (c) => {
      expect((await c.query("update fotos set arquivada = true")).rowCount).toBe(1);
      expect(await contar(c, "fotos")).toBe(1);
      const e2 = await esperarErroSql(c.query("update fotos set arquivada = false"), "P0001");
      expect(e2.message).toBe("Fotos só podem ser arquivadas");
    });
  });

  it("foto arquivada some para a profissional e gera auditoria 'arquivou'", async () => {
    // Outros testes deixam objetos confirmados no bucket: compara antes e depois.
    const objetosProfA = await comoUsuario(profA, (c) => contar(c, "storage.objects"));
    const objetosDona = await comoUsuario(dona, (c) => contar(c, "storage.objects"));
    await comoUsuario(dona, async (c) => {
      await c.query("update fotos set arquivada = true where id = $1", [fotoId]);
      await c.query("set local role authenticated");
      await c.query("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify({ sub: profA, role: "authenticated" }),
      ]);
      expect(await contar(c, "fotos")).toBe(0);
      // O arquivo também some do Storage para ela (um a menos); a dona ainda vê.
      expect(await contar(c, "storage.objects")).toBe(objetosProfA - 1);
      await c.query("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify({ sub: dona, role: "authenticated" }),
      ]);
      expect(await contar(c, "storage.objects")).toBe(objetosDona);
      await comoSuper(c);
      const r = await c.query(
        "select acao, entidade, colaborador_id, cliente_id from auditoria where entidade_id = $1 and acao = 'arquivou'",
        [fotoId],
      );
      expect(r.rows).toEqual([
        { acao: "arquivou", entidade: "fotos", colaborador_id: donaId, cliente_id: cli },
      ]);
    });
  });
});

describe("auditoria", () => {
  it("inserir anamnese grava 'criou'", async () => {
    await comoUsuario(recepcao, async (c) => {
      const id = (await c.query(await insertAnamnese(cli))).rows[0].id;
      await comoSuper(c);
      const r = await c.query(
        "select acao, entidade, colaborador_id, cliente_id from auditoria where entidade_id = $1",
        [id],
      );
      expect(r.rows).toEqual([
        { acao: "criou", entidade: "anamneses", colaborador_id: recepcaoId, cliente_id: cli },
      ]);
    });
  });

  it("evolução editada grava 'alterou'", async () => {
    await comoUsuario(profA, async (c) => {
      const id = (await c.query(insertEvolucao(agDeA, cli))).rows[0].id;
      await c.query("update evolucoes set texto = 'Outro' where id = $1", [id]);
      await comoSuper(c);
      const r = await c.query(
        "select acao from auditoria where entidade_id = $1 order by acao",
        [id],
      );
      expect(r.rows.map((l) => l.acao)).toEqual(["criou", "alterou"]);
    });
  });

  it("registrar_acesso: grava 'visualizou' quando permitido", async () => {
    await comoUsuario(profA, async (c) => {
      await c.query("select registrar_acesso('fotos', $1, $2)", [fotoId, cli]);
      await comoSuper(c);
      const r = await c.query(
        "select acao, entidade, entidade_id, colaborador_id, cliente_id from auditoria where acao = 'visualizou'",
      );
      expect(r.rows).toEqual([
        { acao: "visualizou", entidade: "fotos", entidade_id: fotoId, colaborador_id: profAId, cliente_id: cli },
      ]);
    });
    await comoUsuario(recepcao, (c) => c.query("select registrar_acesso('termos_assinados', null, $1)", [cli]));
    await comoUsuario(dona, (c) => c.query("select registrar_acesso('exportacao', null, $1)", [cli]));
  });

  it("registrar_acesso: nega sem acesso ou entidade inválida", async () => {
    const negar = async (uid: string | null, entidade: string, codigo = "P0001") =>
      (
        await comoUsuario(uid, (c) =>
          esperarErroSql(c.query("select registrar_acesso($1, null, $2)", [entidade, cli]), codigo),
        )
      ).message;
    expect(await negar(profB, "anamneses")).toBe("Acesso não autorizado");
    expect(await negar(recepcao, "fotos")).toBe("Acesso não autorizado");
    expect(await negar(recepcao, "exportacao")).toBe("Acesso não autorizado");
    expect(await negar(dona, "clientes")).toBe("Entidade inválida");
    await negar(null, "anamneses", "42501");
  });

  it("só a dona lê; ninguém escreve direto", async () => {
    await comoUsuario(dona, async (c) => {
      await c.query("select registrar_acesso('anamneses', null, $1)", [cli]);
      expect(await contar(c, "auditoria")).toBeGreaterThan(0);
    });
    expect(await comoUsuario(recepcao, (c) => contar(c, "auditoria"))).toBe(0);
    expect(await comoUsuario(profA, (c) => contar(c, "auditoria"))).toBe(0);
    await comoUsuario(dona, (c) => esperarErroSql(c.query(insertAuditoria()), "42501"));
    await comoUsuario(dona, (c) => esperarErroSql(c.query("delete from auditoria"), "42501"));
    await comoUsuario(dona, (c) => esperarErroSql(c.query("update auditoria set entidade = 'x'"), "42501"));
  });
});

describe("modelos e versões", () => {
  it("dados iniciais: anamnese de estética v1 e termo genérico v1", async () => {
    const a = await q("select titulo, versao, ativo, perguntas from modelos_anamnese");
    expect(a.rows).toHaveLength(1);
    expect(a.rows[0]).toMatchObject({ titulo: "Anamnese de estética", versao: 1, ativo: true });
    const perguntas = a.rows[0].perguntas as { id: string; alerta?: boolean; obrigatoria?: boolean }[];
    expect(perguntas.map((p) => p.id)).toEqual([
      "queixa", "alergias", "gestante", "medicamentos", "anticoagulante", "condicoes",
      "marcapasso", "queloide", "herpes", "isotretinoina", "procedimentos", "sol", "rotina",
    ]);
    expect(perguntas.filter((p) => p.alerta).map((p) => p.id)).toEqual([
      "alergias", "gestante", "anticoagulante", "marcapasso", "queloide", "herpes", "isotretinoina",
    ]);
    expect(perguntas.filter((p) => p.obrigatoria).map((p) => p.id)).toEqual([
      "queixa", "alergias", "gestante", "medicamentos", "anticoagulante",
    ]);
    const t = await q("select titulo, versao, ativo, texto from modelos_termo");
    expect(t.rows).toHaveLength(1);
    expect(t.rows[0]).toMatchObject({ titulo: "Termo de consentimento — modelo genérico", versao: 1, ativo: true });
    expect(t.rows[0].texto).toMatch(/# Procedimento[\s\S]*# Riscos e cuidados[\s\S]*# Declaração/);
  });

  it("todos leem; ninguém escreve direto", async () => {
    for (const uid of [dona, recepcao, profA]) {
      expect(await comoUsuario(uid, (c) => contar(c, "modelos_anamnese"))).toBe(1);
      expect(await comoUsuario(uid, (c) => contar(c, "modelos_termo"))).toBe(1);
    }
    await comoUsuario(dona, (c) =>
      esperarErroSql(c.query("update modelos_anamnese set titulo = 'X'"), "42501"),
    );
    await comoUsuario(dona, (c) =>
      esperarErroSql(c.query("insert into modelos_termo (titulo, texto, versao) values ('X', 'Y', 1)"), "42501"),
    );
  });

  const UMA = '[{"id":"a","tipo":"texto","texto":"A"}]';

  it("salvar_modelo_anamnese cria nova versão e mantém uma só ativa", async () => {
    await comoUsuario(dona, async (c) => {
      await c.query("select salvar_modelo_anamnese('Anamnese', $1::jsonb)", [UMA]);
      const id = (await c.query("select salvar_modelo_anamnese('Anamnese', $1::jsonb) as id", [UMA])).rows[0].id;
      const v = await c.query("select versao, ativo, criado_por, id from modelos_anamnese order by versao");
      expect(v.rows.map((l) => l.versao)).toEqual([1, 2, 3]);
      expect(v.rows.filter((l) => l.ativo)).toEqual([{ versao: 3, ativo: true, criado_por: donaId, id }]);
    });
  });

  it("salvar_modelo_anamnese: só a dona, com perguntas válidas", async () => {
    const erro = async (uid: string, perguntas: string) =>
      (
        await comoUsuario(uid, (c) =>
          esperarErroSql(c.query("select salvar_modelo_anamnese('X', $1::jsonb)", [perguntas]), "P0001"),
        )
      ).message;
    expect(await erro(recepcao, UMA)).toBe("Apenas a dona pode editar modelos");
    expect(await erro(profA, UMA)).toBe("Apenas a dona pode editar modelos");
    expect(await erro(dona, "[]")).toBe("O modelo precisa de ao menos uma pergunta");
    expect(await erro(dona, '{"a":1}')).toBe("O modelo precisa de ao menos uma pergunta");
    expect(await erro(dona, '[{"id":"a","texto":"A"}]')).toBe("Pergunta inválida no modelo");
    expect(await erro(dona, '[{"id":"a","tipo":"outro","texto":"A"}]')).toBe("Pergunta inválida no modelo");
    expect(await erro(dona, '["a"]')).toBe("Pergunta inválida no modelo");
  });

  it("salvar_modelo_termo: nova versão no grupo, serviço passa a apontar para ela", async () => {
    await comoUsuario(dona, async (c) => {
      const v2 = (await c.query("select salvar_modelo_termo($1, 'Termo', 'Texto novo') as id", [termoV1])).rows[0].id;
      const r = await c.query(
        "select id, versao, ativo, grupo_id from modelos_termo order by versao",
      );
      expect(r.rows.map((l) => [l.id, l.versao, l.ativo])).toEqual([
        [termoV1, 1, false],
        [v2, 2, true],
      ]);
      expect(r.rows[0].grupo_id).toBe(r.rows[1].grupo_id);
      const s = await c.query("select modelo_termo_id from servicos where id = $1", [servicoTermoId]);
      expect(s.rows[0].modelo_termo_id).toBe(v2);
      // O anterior não está mais ativo.
      await esperarErroSql(c.query("select salvar_modelo_termo($1, 'T', 'X')", [termoV1]), "P0001");
    });
  });

  it("salvar_modelo_termo: sem anterior cria grupo novo v1; só a dona", async () => {
    await comoUsuario(dona, async (c) => {
      await c.query("select salvar_modelo_termo(null, 'Outro termo', 'Texto')");
      const r = await c.query("select count(*)::int as n, count(distinct grupo_id)::int as g from modelos_termo where ativo");
      expect(r.rows[0]).toEqual({ n: 2, g: 2 });
    });
    const e = await comoUsuario(recepcao, (c) =>
      esperarErroSql(c.query("select salvar_modelo_termo(null, 'X', 'Y')"), "P0001"),
    );
    expect(e.message).toBe("Apenas a dona pode editar modelos");
  });
});

describe("pendências e alertas", () => {
  const SQL_PENDENTES = "select agendamentos_com_termo_pendente($1::uuid[]) as id";

  it("termo pendente até assinar a versão atual", async () => {
    await comoUsuario(dona, async (c) => {
      expect(await idsDe(c, SQL_PENDENTES, [[agTermo, agDeA]])).toEqual([agTermo]);
      await c.query(await insertTermo(cli, termoV1));
      expect(await idsDe(c, SQL_PENDENTES, [[agTermo, agDeA]])).toEqual([]);
      await c.query("select salvar_modelo_termo($1, 'Termo', 'Texto v2')", [termoV1]);
      expect(await idsDe(c, SQL_PENDENTES, [[agTermo, agDeA]])).toEqual([agTermo]);
    });
  });

  it("situacao_ficha: última anamnese e alerta", async () => {
    const situacao = (c: PoolClient, ids: string[]) =>
      c.query("select cliente_id, ultima_anamnese_em is not null as tem, tem_alerta from situacao_ficha($1::uuid[]) order by cliente_id = $2 desc", [ids, cli]);
    await comoUsuario(recepcao, async (c) => {
      expect((await situacao(c, [cli, cli2])).rows).toEqual([
        { cliente_id: cli, tem: true, tem_alerta: false },
        { cliente_id: cli2, tem: false, tem_alerta: false },
      ]);
      await c.query(await insertAnamnese(cli, { respostas: { ...RESPOSTAS_NAO, gestante: true } }));
      expect((await situacao(c, [cli])).rows).toEqual([{ cliente_id: cli, tem: true, tem_alerta: true }]);
    });
    await comoUsuario(recepcao, async (c) => {
      await c.query(await insertAnamnese(cli, { respostas: { ...RESPOSTAS_NAO, alergias: { sim: true, detalhe: "Dipirona" } } }));
      expect((await situacao(c, [cli])).rows).toEqual([{ cliente_id: cli, tem: true, tem_alerta: true }]);
    });
    await comoUsuario(recepcao, async (c) => {
      // "sim" em pergunta sem alerta não conta.
      await c.query(await insertAnamnese(cli, { respostas: { ...RESPOSTAS_NAO, medicamentos: { sim: true }, sol: true } }));
      expect((await situacao(c, [cli])).rows).toEqual([{ cliente_id: cli, tem: true, tem_alerta: false }]);
    });
    // Profissional B só enxerga a cliente vinculada a ela.
    await comoUsuario(profB, async (c) => {
      expect((await situacao(c, [cli, cli2])).rows).toEqual([
        { cliente_id: cli2, tem: false, tem_alerta: false },
      ]);
    });
  });

  it("atendimentos_sem_termo: só a dona; período limitado", async () => {
    const sql = "select atendimentos_sem_termo($1::date, $2::date) as id";
    expect(await comoUsuario(dona, (c) => idsDe(c, sql, ["2030-07-01", "2030-07-31"]))).toEqual([agTermo]);
    expect(await comoUsuario(dona, (c) => idsDe(c, sql, ["2030-07-11", "2030-07-31"]))).toEqual([]);
    expect(await comoUsuario(recepcao, (c) => idsDe(c, sql, ["2030-07-01", "2030-07-31"]))).toEqual([]);
    await comoUsuario(dona, async (c) => {
      await c.query(await insertTermo(cli, termoV1));
      expect(await idsDe(c, sql, ["2030-07-01", "2030-07-31"])).toEqual([]);
    });
    const e = await comoUsuario(dona, (c) =>
      esperarErroSql(c.query(sql, ["2030-01-01", "2030-12-31"]), "P0001"),
    );
    expect(e.message).toBe("Período inválido");
  });
});

describe("estrutura e ajustes herdados", () => {
  const proconfig = async (nome: string) =>
    (await q("select proconfig from pg_proc where proname = $1", [nome])).rows[0].proconfig;
  const existeIndiceSobre = async (tabela: string, coluna: string) =>
    (
      await q(
        `select exists (
           select 1 from pg_index i
           join pg_attribute a on a.attrelid = i.indrelid and a.attnum = i.indkey[0]
           where i.indrelid = ('public.' || $1)::regclass and a.attname = $2
         ) as e`,
        [tabela, coluna],
      )
    ).rows[0].e;

  it("normalizar_busca com search_path vazio", async () => {
    expect(await proconfig("normalizar_busca")).toEqual(['search_path=""']);
  });

  it.each([
    ["agendamentos", "criado_por"],
    ["agendamentos", "servico_id"],
    ["caixas", "aberto_por"],
    ["caixas", "fechado_por"],
    ["pagamentos", "lancado_por"],
    ["servicos", "modelo_termo_id"],
    ["anamneses", "modelo_id"],
    ["anamneses", "preenchida_por"],
    ["termos_assinados", "cliente_id"],
    ["termos_assinados", "modelo_termo_id"],
    ["termos_assinados", "agendamento_id"],
    ["termos_assinados", "colhido_por"],
    ["fotos", "cliente_id"],
    ["fotos", "agendamento_id"],
    ["fotos", "servico_id"],
    ["fotos", "enviada_por"],
    ["evolucoes", "cliente_id"],
    ["evolucoes", "agendamento_id"],
    ["evolucoes", "profissional_id"],
    ["auditoria", "colaborador_id"],
    ["auditoria", "cliente_id"],
    ["modelos_anamnese", "criado_por"],
    ["modelos_termo", "criado_por"],
  ])("índice sobre %s.%s", async (t, col) => {
    expect(await existeIndiceSobre(t, col)).toBe(true);
  });

  it("FK servicos_modelo_termo_id_fkey", async () => {
    const r = await q(
      "select confrelid::regclass::text as alvo from pg_constraint where conname = 'servicos_modelo_termo_id_fkey'",
    );
    expect(r.rows).toEqual([{ alvo: "modelos_termo" }]);
  });

  it.each([
    ["acesso_clinico", true, "s", true],
    ["cliente_do_caminho", false, "i", true],
    ["area_do_caminho", false, "i", true],
    ["foto_arquivada", true, "s", true],
    ["registrar_acesso", true, "v", true],
    ["salvar_modelo_anamnese", true, "v", true],
    ["salvar_modelo_termo", true, "v", true],
    ["situacao_ficha", false, "s", true],
    ["agendamentos_com_termo_pendente", false, "s", true],
    ["atendimentos_sem_termo", true, "s", true],
    ["auditar_ficha", true, "v", false],
    ["fotos_guarda", false, "v", false],
    ["evolucoes_guarda", false, "v", false],
  ] as const)("%s: definer=%s, volatilidade %s, search_path vazio, sem anon", async (nome, definer, volatil, auth) => {
    const r = await q(
      `select prosecdef as definer, provolatile as volatil, proconfig as config,
              has_function_privilege('anon', oid, 'execute') as anon,
              has_function_privilege('authenticated', oid, 'execute') as auth
       from pg_proc where proname = $1 and pronamespace = 'public'::regnamespace`,
      [nome],
    );
    expect(r.rows).toEqual([{ definer, volatil, config: ['search_path=""'], anon: false, auth }]);
  });

  it("sem privilégio de delete nas tabelas clínicas", async () => {
    const r = await q(
      `select t, has_table_privilege('authenticated', 'public.' || t, 'delete') as auth,
              has_table_privilege('anon', 'public.' || t, 'select') as anon
       from unnest(array['anamneses','termos_assinados','fotos','evolucoes','auditoria','modelos_anamnese','modelos_termo']) t`,
    );
    for (const l of r.rows) expect(l).toEqual({ t: l.t, auth: false, anon: false });
  });
});
