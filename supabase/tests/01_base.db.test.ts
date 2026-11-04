import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  comoSuperusuario,
  comoUsuario,
  contar,
  criarUsuario,
  criarUsuarioSemColaborador,
  esperarErroSql,
  fecharConexoes,
  lerSqlSupabase,
  resetarBanco,
} from "./helpers";

let dona: string;
let donaColaboradorId: string;
let recepcao: string;
let profissional: string;
let recepcaoInativa: string;
let donaInativa: string;
let semColaborador: string;
let servicoId: string;
let categoriaId: string;
let produtoSemCustoId: string;

const SQL_CONFIGURACAO = `insert into configuracoes_clinica (nome, horario_funcionamento)
  values ('Madame Fê Clinic', '{"1":[{"inicio":"09:00","fim":"19:00"}]}')`;

beforeAll(async () => {
  await resetarBanco();
  const fe = await criarUsuario("dona", { nome: "Fê" });
  dona = fe.uid;
  donaColaboradorId = fe.colaboradorId;
  recepcao = (await criarUsuario("recepcao")).uid;
  profissional = (await criarUsuario("profissional")).uid;
  recepcaoInativa = (await criarUsuario("recepcao", { ativo: false })).uid;
  donaInativa = (await criarUsuario("dona", { ativo: false })).uid;
  semColaborador = await criarUsuarioSemColaborador();

  await comoSuperusuario(async (c) => {
    await c.query(SQL_CONFIGURACAO);
    const cat = await c.query<{ id: string }>(
      "insert into categorias_servico (nome) values ('Facial') returning id",
    );
    categoriaId = cat.rows[0].id;
    const serv = await c.query<{ id: string }>(
      `insert into servicos (nome, categoria_id, duracao_min, preco_centavos)
       values ('Peeling', $1, 60, 25000) returning id`,
      [categoriaId],
    );
    servicoId = serv.rows[0].id;
    const prod = await c.query<{ id: string }>(
      "insert into produtos (nome, unidade) values ('Ácido glicólico', 'ml') returning id",
    );
    await c.query(
      "insert into produtos_custos (produto_id, custo_unitario_centavos) values ($1, 150)",
      [prod.rows[0].id],
    );
    const semCusto = await c.query<{ id: string }>(
      "insert into produtos (nome) values ('Algodão') returning id",
    );
    produtoSemCustoId = semCusto.rows[0].id;
    await c.query(
      `insert into clientes (nome, whatsapp, aceite_lgpd_em)
       values ('Cliente Existente', '5511912345678', now())`,
    );
  });
});

afterAll(fecharConexoes);

describe("perfil_atual / colaborador_atual_id", () => {
  it("retorna o perfil do colaborador ativo logado", async () => {
    const r = await comoUsuario(dona, (c) =>
      c.query(
        "select public.perfil_atual() as perfil, public.colaborador_atual_id() is not null as tem_id",
      ),
    );
    expect(r.rows[0]).toEqual({ perfil: "dona", tem_id: true });
  });

  it("retorna null para colaborador desativado", async () => {
    const r = await comoUsuario(recepcaoInativa, (c) =>
      c.query(
        "select public.perfil_atual() as perfil, public.colaborador_atual_id() as id",
      ),
    );
    expect(r.rows[0]).toEqual({ perfil: null, id: null });
  });

  it("anônimo não pode executar perfil_atual()", async () => {
    await comoUsuario(null, (c) =>
      esperarErroSql(c.query("select public.perfil_atual()"), "42501"),
    );
  });

  it("cliente_vinculada retorna false para cliente sem agendamento", async () => {
    const r = await comoUsuario(profissional, (c) =>
      c.query<{ v: boolean }>(
        "select public.cliente_vinculada(gen_random_uuid()) as v",
      ),
    );
    expect(r.rows[0].v).toBe(false);
  });
});

describe("serviços", () => {
  it("recepção vê os serviços", async () => {
    expect(await comoUsuario(recepcao, (c) => contar(c, "servicos"))).toBe(1);
  });

  it("recepção não altera serviço (RLS filtra: 0 linhas)", async () => {
    const r = await comoUsuario(recepcao, (c) =>
      c.query("update servicos set preco_centavos = 1 where true"),
    );
    expect(r.rowCount).toBe(0);
  });

  it("dona altera serviço", async () => {
    const r = await comoUsuario(dona, (c) =>
      c.query("update servicos set preco_centavos = 1 where id = $1", [
        servicoId,
      ]),
    );
    expect(r.rowCount).toBe(1);
  });

  it("profissional não exclui serviço", async () => {
    const r = await comoUsuario(profissional, (c) =>
      c.query("delete from servicos where true"),
    );
    expect(r.rowCount).toBe(0);
  });
});

describe("clientes", () => {
  it("profissional sem vínculo não vê clientes", async () => {
    expect(await comoUsuario(profissional, (c) => contar(c, "clientes"))).toBe(
      0,
    );
  });

  it("recepção vê todas as clientes", async () => {
    expect(await comoUsuario(recepcao, (c) => contar(c, "clientes"))).toBe(1);
  });

  it("recepção cadastra cliente", async () => {
    const r = await comoUsuario(recepcao, (c) =>
      c.query(
        `insert into clientes (nome, whatsapp, aceite_lgpd_em)
         values ('Ana', '5511987654321', now()) returning id`,
      ),
    );
    expect(r.rowCount).toBe(1);
  });

  it("CPF duplicado é barrado (23505, clientes_cpf_key)", async () => {
    const erro = await comoUsuario(recepcao, (c) =>
      esperarErroSql(
        c.query(
          `insert into clientes (nome, cpf, aceite_lgpd_em)
           values ('B', '52998224725', now()), ('C', '52998224725', now())`,
        ),
        "23505",
      ),
    );
    expect(erro.constraint).toBe("clientes_cpf_key");
  });

  it("várias clientes sem CPF são permitidas", async () => {
    const r = await comoUsuario(recepcao, (c) =>
      c.query(
        `insert into clientes (nome, aceite_lgpd_em)
         values ('Sem CPF 1', now()), ('Sem CPF 2', now())`,
      ),
    );
    expect(r.rowCount).toBe(2);
  });

  it("profissional não cadastra cliente (42501)", async () => {
    await comoUsuario(profissional, (c) =>
      esperarErroSql(
        c.query(
          `insert into clientes (nome, aceite_lgpd_em) values ('X', now())`,
        ),
        "42501",
      ),
    );
  });

  it("ninguém exclui cliente (exclusão lógica)", async () => {
    const r = await comoUsuario(dona, (c) =>
      c.query("delete from clientes where true"),
    );
    expect(r.rowCount).toBe(0);
  });
});

describe("restrições de dados das clientes", () => {
  const casos: [string, string][] = [
    ["CPF com pontuação", "cpf = '529.982.247-25'"],
    ["WhatsApp não normalizado", "whatsapp = '(11) 98765-4321'"],
    ["WhatsApp sem 55", "whatsapp = '11987654321'"],
    ["origem desconhecida", "origem = 'tiktok'"],
  ];
  it.each(casos)("%s é rejeitado (23514)", async (_nome, atribuicao) => {
    await comoSuperusuario(async (c) => {
      await c.query("savepoint s");
      await esperarErroSql(
        c.query(`update clientes set ${atribuicao} where true`),
        "23514",
      );
      await c.query("rollback to savepoint s");
    });
  });

  it("origens válidas são aceitas", async () => {
    const r = await comoUsuario(recepcao, (c) =>
      c.query(
        `insert into clientes (nome, origem, aceite_lgpd_em)
         select 'O ' || o, o, now()
         from unnest(array['instagram','indicacao','google','passou_na_frente','outro']) o`,
      ),
    );
    expect(r.rowCount).toBe(5);
  });
});

describe("colaborador desativado / desconhecido", () => {
  it("inativo não acessa clientes nem serviços", async () => {
    const [clientes, servicos, colaboradores] = await comoUsuario(
      recepcaoInativa,
      async (c) => [
        await contar(c, "clientes"),
        await contar(c, "servicos"),
        await contar(c, "colaboradores"),
      ],
    );
    expect(clientes).toBe(0);
    expect(servicos).toBe(0);
    expect(colaboradores).toBe(0);
  });

  it("usuário sem colaborador não vê nada", async () => {
    const [servicos, config] = await comoUsuario(semColaborador, async (c) => [
      await contar(c, "servicos"),
      await contar(c, "configuracoes_clinica"),
    ]);
    expect(servicos).toBe(0);
    expect(config).toBe(0);
  });
});

describe("anônimo", () => {
  it("não vê colaboradores, serviços nem clientes", async () => {
    const contagens = await comoUsuario(null, async (c) => [
      await contar(c, "colaboradores"),
      await contar(c, "servicos"),
      await contar(c, "clientes"),
      await contar(c, "configuracoes_clinica"),
    ]);
    expect(contagens).toEqual([0, 0, 0, 0]);
  });
});

describe("custos de produtos (somente dona — R10)", () => {
  it("recepção vê o produto mas não o custo", async () => {
    const [produtos, custos] = await comoUsuario(recepcao, async (c) => [
      await contar(c, "produtos"),
      await contar(c, "produtos_custos"),
    ]);
    expect(produtos).toBe(2);
    expect(custos).toBe(0);
  });

  it("dona vê o custo", async () => {
    expect(await comoUsuario(dona, (c) => contar(c, "produtos_custos"))).toBe(
      1,
    );
  });

  it("produtos não tem coluna de custo", async () => {
    const r = await comoSuperusuario((c) =>
      c.query(
        `select column_name from information_schema.columns
         where table_schema = 'public' and table_name = 'produtos' and column_name like '%custo%'`,
      ),
    );
    expect(r.rowCount).toBe(0);
  });
});

describe("configurações da clínica", () => {
  it("recepção lê mas não altera (0 linhas)", async () => {
    const [vistas, alteradas] = await comoUsuario(recepcao, async (c) => [
      await contar(c, "configuracoes_clinica"),
      (await c.query("update configuracoes_clinica set nome = 'X' where true"))
        .rowCount,
    ]);
    expect(vistas).toBe(1);
    expect(alteradas).toBe(0);
  });

  it("dona altera", async () => {
    const r = await comoUsuario(dona, (c) =>
      c.query("update configuracoes_clinica set telefone = '5511999990000'"),
    );
    expect(r.rowCount).toBe(1);
  });

  it("só existe uma linha de configuração", async () => {
    await comoSuperusuario(async (c) => {
      await c.query("savepoint s");
      await esperarErroSql(
        c.query("insert into configuracoes_clinica (nome) values ('Outra')"),
        "23505",
      );
      await c.query("rollback to savepoint s");
    });
  });
});

describe("equipe", () => {
  it("todos os colaboradores ativos veem a equipe (agenda)", async () => {
    // dona, recepção, profissional e as duas inativas (a dona precisa ver todas).
    expect(
      await comoUsuario(profissional, (c) => contar(c, "colaboradores")),
    ).toBe(5);
  });

  it("recepção não altera colaborador (0 linhas)", async () => {
    const r = await comoUsuario(recepcao, (c) =>
      c.query("update colaboradores set perfil = 'dona' where true"),
    );
    expect(r.rowCount).toBe(0);
  });

  it("atualizado_em é renovado no update", async () => {
    const r = await comoSuperusuario(async (c) => {
      await c.query("savepoint s");
      await c.query(
        "update colaboradores set criado_em = now() - interval '1 day', atualizado_em = now() - interval '1 day'",
      );
      const depois = await c.query<{ ok: boolean }>(
        `update colaboradores set funcao = 'esteticista'
         returning atualizado_em > criado_em as ok`,
      );
      await c.query("rollback to savepoint s");
      return depois.rows.every((l) => l.ok);
    });
    expect(r).toBe(true);
  });
});

describe("seed.sql", () => {
  it("aplica sobre o banco migrado", async () => {
    const seed = await lerSqlSupabase("seed.sql");
    const r = await comoSuperusuario(async (c) => {
      await c.query("savepoint s");
      await c.query(
        `delete from servico_produtos; delete from produtos_custos; delete from produtos;
         delete from colaborador_servicos; delete from servicos; delete from categorias_servico;
         delete from configuracoes_clinica;`,
      );
      await c.query(seed);
      const contagem = await c.query<{
        config: number;
        horario_sabado: string;
        categorias: number;
        servicos: number;
        peeling: number;
        produtos: number;
      }>(
        `select (select count(*)::int from configuracoes_clinica where nome = 'Madame Fê Clinic') as config,
                (select horario_funcionamento -> '6' -> 0 ->> 'fim' from configuracoes_clinica) as horario_sabado,
                (select count(*)::int from categorias_servico) as categorias,
                (select count(*)::int from servicos) as servicos,
                (select count(*)::int from servicos where nome = 'Peeling') as peeling,
                (select count(*)::int from produtos) as produtos`,
      );
      await c.query("rollback to savepoint s");
      return contagem.rows[0];
    });
    expect(r).toEqual({
      config: 1,
      horario_sabado: "19:00",
      categorias: 2,
      servicos: 3,
      peeling: 1,
      produtos: 1,
    });
  });
});

describe("matriz de inserção por perfil (RLS WITH CHECK)", () => {
  type Ator = "dona" | "recepcao" | "profissional" | "donaInativa" | "anon";
  const ATORES: Ator[] = [
    "dona",
    "recepcao",
    "profissional",
    "donaInativa",
    "anon",
  ];
  const uidDe = (ator: Ator): string | null =>
    ({ dona, recepcao, profissional, donaInativa, anon: null })[ator];

  type Caso = {
    tabela: string;
    sql: () => [string, unknown[]];
    permitidos: Ator[];
    /** Prepara/restaura dados (como superusuário) só para o caso positivo. */
    antes?: () => Promise<void>;
    depois?: () => Promise<void>;
  };

  const casos: Caso[] = [
    {
      tabela: "configuracoes_clinica",
      sql: () => ["insert into configuracoes_clinica (nome) values ('Nova')", []],
      permitidos: ["dona"],
      // Linha única: remove a existente para o insert da dona caber.
      antes: () =>
        comoSuperusuario(async (c) => {
          await c.query("delete from configuracoes_clinica");
        }),
      depois: () =>
        comoSuperusuario(async (c) => {
          await c.query("delete from configuracoes_clinica");
          await c.query(SQL_CONFIGURACAO);
        }),
    },
    {
      tabela: "colaboradores",
      sql: () => [
        "insert into colaboradores (nome, perfil) values ('Nova', 'profissional')",
        [],
      ],
      permitidos: ["dona"],
    },
    {
      tabela: "jornadas",
      sql: () => [
        `insert into jornadas (colaborador_id, dia_semana, hora_inicio, hora_fim)
         values ($1, 1, '09:00', '12:00')`,
        [donaColaboradorId],
      ],
      permitidos: ["dona"],
    },
    {
      tabela: "bloqueios_agenda",
      sql: () => [
        `insert into bloqueios_agenda (colaborador_id, inicio, fim, motivo)
         values ($1, now(), now() + interval '1 day', 'folga')`,
        [donaColaboradorId],
      ],
      permitidos: ["dona"],
    },
    {
      tabela: "colaborador_servicos",
      sql: () => [
        "insert into colaborador_servicos (colaborador_id, servico_id) values ($1, $2)",
        [donaColaboradorId, servicoId],
      ],
      permitidos: ["dona"],
    },
    {
      tabela: "categorias_servico",
      sql: () => ["insert into categorias_servico (nome) values ('Corporal')", []],
      permitidos: ["dona"],
    },
    {
      tabela: "servicos",
      sql: () => [
        `insert into servicos (nome, categoria_id, duracao_min) values ('Novo', $1, 30)`,
        [categoriaId],
      ],
      permitidos: ["dona"],
    },
    {
      tabela: "servico_produtos",
      sql: () => [
        "insert into servico_produtos (servico_id, produto_id, quantidade) values ($1, $2, 1)",
        [servicoId, produtoSemCustoId],
      ],
      permitidos: ["dona"],
    },
    {
      tabela: "produtos",
      sql: () => ["insert into produtos (nome) values ('Luva')", []],
      permitidos: ["dona"],
    },
    {
      tabela: "produtos_custos",
      sql: () => [
        "insert into produtos_custos (produto_id, custo_unitario_centavos) values ($1, 10)",
        [produtoSemCustoId],
      ],
      permitidos: ["dona"],
    },
    {
      tabela: "clientes",
      sql: () => [
        "insert into clientes (nome, aceite_lgpd_em) values ('Nova', now())",
        [],
      ],
      permitidos: ["dona", "recepcao"],
    },
  ];

  describe.each(casos)("$tabela", (caso) => {
    it.each(ATORES)("%s", async (ator) => {
      const [sql, params] = caso.sql();
      if (caso.permitidos.includes(ator)) {
        await caso.antes?.();
        try {
          const r = await comoUsuario(uidDe(ator), (c) => c.query(sql, params));
          expect(r.rowCount).toBe(1);
        } finally {
          await caso.depois?.();
        }
      } else {
        await comoUsuario(uidDe(ator), (c) =>
          esperarErroSql(c.query(sql, params), "42501"),
        );
      }
    });
  });

  it("RLS habilitado em todas as tabelas do schema public", async () => {
    const r = await comoSuperusuario((c) =>
      c.query<{ relname: string }>(
        `select relname from pg_class
         where relnamespace = 'public'::regnamespace and relkind = 'r' and not relrowsecurity`,
      ),
    );
    expect(r.rows).toEqual([]);
  });
});

describe("alterações negadas (0 linhas)", () => {
  it("recepção não altera custo de produto", async () => {
    const r = await comoUsuario(recepcao, (c) =>
      c.query("update produtos_custos set custo_unitario_centavos = 1 where true"),
    );
    expect(r.rowCount).toBe(0);
  });

  it("dona altera custo de produto", async () => {
    const r = await comoUsuario(dona, (c) =>
      c.query("update produtos_custos set custo_unitario_centavos = 1 where true"),
    );
    expect(r.rowCount).toBe(1);
  });

  it("profissional não altera cliente", async () => {
    const r = await comoUsuario(profissional, (c) =>
      c.query("update clientes set observacoes = 'x' where true"),
    );
    expect(r.rowCount).toBe(0);
  });

  it("recepção altera cliente", async () => {
    const r = await comoUsuario(recepcao, (c) =>
      c.query("update clientes set observacoes = 'x' where true"),
    );
    expect(r.rowCount).toBe(1);
  });

  it("dona inativa não altera serviço nem configuração", async () => {
    const [servicos, config] = await comoUsuario(donaInativa, async (c) => [
      (await c.query("update servicos set preco_centavos = 1 where true"))
        .rowCount,
      (await c.query("update configuracoes_clinica set nome = 'X' where true"))
        .rowCount,
    ]);
    expect(servicos).toBe(0);
    expect(config).toBe(0);
  });
});
