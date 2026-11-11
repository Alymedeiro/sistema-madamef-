// Comissões e estoque ponta a ponta (Fase 4B), nos 3 tamanhos. Roda contra o projeto Supabase
// de TESTES já com a 0011 aplicada; sem E2E_PERMITIR_PROJETO/backend é pulado (Ruling R3).
// ATENÇÃO: comissões, movimentos de estoque e contas a pagar não têm "delete" (nem para o
// service_role). A limpeza só desativa o produto e o serviço criados (prefixo "E2E Comissões");
// a comissão paga, a despesa de salário, os movimentos, a cliente e o atendimento ficam no
// projeto de testes. "Pagar comissões" paga TODAS as comissões em aberto da profissional de
// teste naquele mês, então os 3 viewports (e os specs que mexem em caixa/financeiro) se
// revezam pela trava compartilhada de e2e/trava-caixa.ts, e as verificações se limitam ao que
// esta execução criou.
import { expect, test, type Page } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ARQUIVO_ESTADO, pularSemBackend } from "./suporte";
import { clienteAdmin, prepararFicha, type FixtureFicha } from "./ficha-suporte";
import { TIMEOUT_PREPARACAO_MS, adquirirTravaCaixa } from "./trava-caixa";

test.describe.configure({ mode: "serial" });

const VIEWPORTS = ["computador", "tablet", "celular"];

let admin: SupabaseClient;
let liberarTrava: (() => Promise<void>) | null = null;
let indice = 0;
let prefixo = "";
let fx: FixtureFicha;
let servicoId = "";
let produtoId = "";
let produtoNome = "";
let comissaoCentavos = 0;
let competencia = "";

async function falhar(p: PromiseLike<{ error: unknown }>) {
  const { error } = await p;
  if (error) throw error;
}

async function estoqueAtual(): Promise<number> {
  const { data, error } = await admin.from("produtos").select("estoque_atual").eq("id", produtoId).single();
  if (error) throw error;
  return Number(data.estoque_atual);
}

/** Linha visível do produto na aba Estoque (cartão no celular, tabela nos demais). */
const linhaProduto = (page: Page) =>
  page.locator('[data-testid="produto-estoque"]:visible').filter({ hasText: produtoNome });

test.beforeAll(async ({}, testInfo) => {
  test.setTimeout(TIMEOUT_PREPARACAO_MS);
  await pularSemBackend("E2E de comissões e estoque");
  admin = clienteAdmin();
  indice = Math.max(0, VIEWPORTS.indexOf(testInfo.project.name));
  liberarTrava = await adquirirTravaCaixa();

  // Atendimento confirmado de R$ 100,00 em hoje+5 (um horário por viewport).
  fx = await prepararFicha(admin, String(15 + indice));
  prefixo = `E2E Comissões ${VIEWPORTS[indice]} ${Date.now()}`;
  comissaoCentavos = 2000; // 20% de R$ 100,00
  competencia = `${fx.data.slice(5, 7)}/${fx.data.slice(0, 4)}`;

  const { data: ag, error: ea } = await admin
    .from("agendamentos")
    .select("servico_id")
    .eq("id", fx.agendamentoId)
    .single();
  if (ea) throw ea;
  servicoId = ag.servico_id;

  // Produto novo (estoque 0), consumido em 2 un por atendimento do serviço.
  produtoNome = `${prefixo} produto`;
  const { data: produto, error: ep } = await admin
    .from("produtos")
    .insert({ nome: produtoNome, unidade: "un", estoque_minimo: 0 })
    .select("id")
    .single();
  if (ep) throw ep;
  produtoId = produto.id;
  await falhar(admin.from("servico_produtos").insert({ servico_id: servicoId, produto_id: produtoId, quantidade: 2 }));
});

test.afterAll(async () => {
  try {
    if (liberarTrava && admin) {
      // Nada é apagado: só desativa o que este spec criou (erros de limpeza não derrubam o spec).
      if (produtoId) await admin.from("produtos").update({ ativo: false }).eq("id", produtoId);
      if (servicoId) await admin.from("servicos").update({ ativo: false }).eq("id", servicoId);
    }
  } finally {
    await liberarTrava?.();
  }
});

test.describe("dona e recepção", () => {
  test("dona configura 20% no serviço", async ({ browser }) => {
    const contexto = await browser.newContext({ storageState: ARQUIVO_ESTADO("dona") });
    const page = await contexto.newPage();
    try {
      await page.goto(`/servicos/${servicoId}`);
      await page.getByLabel("Comissão (%)").fill("20");
      await page.getByRole("button", { name: "Salvar", exact: true }).click();
      await expect(page.getByText("Serviço salvo.")).toBeVisible();
      const { data } = await admin.from("servicos_comissao").select("percentual").eq("servico_id", servicoId).single();
      expect(Number(data?.percentual)).toBe(20);
    } finally {
      await contexto.close();
    }
  });

  test("dona dá entrada de 10 un no estoque do produto", async ({ browser }) => {
    const contexto = await browser.newContext({ storageState: ARQUIVO_ESTADO("dona") });
    const page = await contexto.newPage();
    try {
      await page.goto("/produtos?aba=estoque");
      const linha = linhaProduto(page);
      await expect(linha).toHaveCount(1);
      await linha.getByRole("button", { name: /^Entrada/ }).click();
      const dialogo = page.getByRole("dialog", { name: "Entrada" });
      await dialogo.getByLabel("Quantidade (un)").fill("10");
      await dialogo.getByLabel("Custo por un (R$)").fill("5,00");
      await dialogo.getByRole("button", { name: "Registrar entrada" }).click();
      await expect(dialogo).toBeHidden();
      await expect(linhaProduto(page)).toContainText(/(?<!\d)10 un/);
      expect(await estoqueAtual()).toBe(10);
    } finally {
      await contexto.close();
    }
  });

  test("recepção marca atendido e não vê as abas Comissões nem Estoque", async ({ browser }) => {
    const contexto = await browser.newContext({ storageState: ARQUIVO_ESTADO("recepcao") });
    const page = await contexto.newPage();
    try {
      await page.goto(`/agenda?data=${fx.data}&visao=dia&prof=${fx.profissional.id}`);
      await page.getByRole("button", { name: new RegExp(`^${fx.hora}:00 ${fx.cliente.nome}`) }).click();
      await page.getByRole("button", { name: "Marcar como atendido" }).click();
      // Abre o pagamento do atendimento: não é o foco aqui (e não mexe no caixa); só fecha.
      const pagamento = page.getByRole("dialog", { name: "Pagamento do atendimento" });
      await expect(pagamento).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(pagamento).toBeHidden();

      await expect
        .poll(async () => {
          const { data } = await admin.from("agendamentos").select("status").eq("id", fx.agendamentoId).single();
          return data?.status;
        })
        .toBe("atendido");

      // Recepção: Financeiro só com o Caixa do dia (sem a navegação de abas), Produtos sem a aba Estoque.
      await page.goto("/financeiro?aba=comissoes");
      await expect(page.getByRole("heading", { name: "Caixa do dia", level: 1 })).toBeVisible();
      await expect(page.getByRole("navigation", { name: "Seções do financeiro" })).toHaveCount(0);
      await expect(page.getByRole("link", { name: "Comissões" })).toHaveCount(0);
      await expect(page.getByTestId("comissao-resumo")).toHaveCount(0);

      await page.goto("/produtos?aba=estoque");
      await expect(page.getByRole("heading", { name: "Produtos", level: 1 })).toBeVisible();
      await expect(page.getByRole("navigation", { name: "Seções de produtos" })).toHaveCount(0);
      await expect(page.getByRole("link", { name: "Estoque" })).toHaveCount(0);
      await expect(page.getByTestId("produto-estoque")).toHaveCount(0);
    } finally {
      await contexto.close();
    }
  });

  test("dona vê a comissão em aberto e o estoque baixado", async ({ browser }) => {
    const contexto = await browser.newContext({ storageState: ARQUIVO_ESTADO("dona") });
    const page = await contexto.newPage();
    try {
      await page.goto(
        `/financeiro?aba=comissoes&periodo=personalizado&de=${fx.data}&ate=${fx.data}&profissional=${fx.profissional.id}`,
      );
      await expect(page.getByRole("link", { name: "Comissões" })).toHaveAttribute("aria-current", "page");
      const linha = page.getByTestId("comissao").filter({ hasText: fx.cliente.nome });
      await expect(linha).toHaveCount(1);
      await expect(linha).toContainText("Em aberto");
      await expect(linha).toContainText(/R\$\s*20,00/);
      await expect(linha).toContainText(/R\$\s*100,00/);

      // Estoque: 10 − 2 = 8 un, com a baixa no histórico.
      await page.goto("/produtos?aba=estoque");
      await expect(linhaProduto(page)).toContainText(/(?<!\d)8 un/);
      expect(await estoqueAtual()).toBe(8);
      await page.goto(`/produtos?aba=estoque&produto=${produtoId}`);
      await expect(page.getByTestId("movimento").filter({ hasText: "Baixa (atendimento)" }).first()).toBeVisible();
    } finally {
      await contexto.close();
    }
  });

  test("?produto=<id> destaca a linha do produto e filtra o histórico", async ({ browser }) => {
    const contexto = await browser.newContext({ storageState: ARQUIVO_ESTADO("dona") });
    const page = await contexto.newPage();
    try {
      await page.goto(`/produtos?aba=estoque&produto=${produtoId}`);
      await expect(linhaProduto(page)).toHaveAttribute("aria-current", "true");
      // Só esta linha está destacada.
      await expect(page.locator('[data-testid="produto-estoque"][aria-current="true"]:visible')).toHaveCount(1);

      // Histórico filtrado: só movimentos deste produto (entrada de 10 e baixa de 2).
      const movimentos = page.locator('[data-testid="movimento"]:visible');
      await expect(movimentos).toHaveCount(2);
      await expect(movimentos.filter({ hasText: "Baixa (atendimento)" })).toHaveCount(1);
      await expect(movimentos.filter({ hasText: "Entrada" })).toHaveCount(1);

      // Sem o filtro, nenhuma linha fica destacada.
      await page.goto("/produtos?aba=estoque");
      await expect(page.locator('[data-testid="produto-estoque"][aria-current="true"]')).toHaveCount(0);
    } finally {
      await contexto.close();
    }
  });

  test("ajuste muda o estoque para a quantidade contada", async ({ browser }) => {
    const contexto = await browser.newContext({ storageState: ARQUIVO_ESTADO("dona") });
    const page = await contexto.newPage();
    try {
      await page.goto(`/produtos?aba=estoque&produto=${produtoId}`);
      await linhaProduto(page).getByRole("button", { name: /^Ajuste/ }).click();
      const dialogo = page.getByRole("dialog", { name: "Ajuste" });
      await dialogo.getByLabel("Quantidade contada (un)").fill("5");
      await dialogo.getByLabel("Motivo").fill("Contagem do E2E");
      await dialogo.getByRole("button", { name: "Salvar ajuste" }).click();
      await expect(dialogo).toBeHidden();
      await expect(linhaProduto(page)).toContainText(/(?<!\d)5 un/);
      expect(await estoqueAtual()).toBe(5);
    } finally {
      await contexto.close();
    }
  });

  test("Pagar comissões: situação Paga e despesa em Contas a pagar", async ({ browser }) => {
    const contexto = await browser.newContext({ storageState: ARQUIVO_ESTADO("dona") });
    const page = await contexto.newPage();
    try {
      await page.goto(
        `/financeiro?aba=comissoes&periodo=personalizado&de=${fx.data}&ate=${fx.data}&profissional=${fx.profissional.id}`,
      );
      const resumo = page
        .getByTestId("comissao-resumo")
        .filter({ hasText: fx.profissional.nome })
        .filter({ hasText: competencia });
      await expect(resumo).toHaveCount(1);
      await resumo.getByRole("button", { name: "Pagar comissões" }).click();
      const dialogo = page.getByRole("dialog", { name: "Pagar comissões" });
      await expect(dialogo).toContainText(`${fx.profissional.nome} — ${competencia}`);
      await dialogo.getByRole("button", { name: "Confirmar pagamento" }).click();
      await expect(dialogo).toBeHidden();

      const linha = page.getByTestId("comissao").filter({ hasText: fx.cliente.nome });
      await expect(linha).toContainText("Paga");

      // O filtro de situação só mostra comissões pagas.
      await page.getByLabel("Situação").selectOption({ label: "Pagas" });
      await page.getByRole("button", { name: "Filtrar" }).click();
      await expect(page.getByTestId("comissao").filter({ hasText: fx.cliente.nome })).toHaveCount(1);

      // Despesa de salário já paga, com a descrição combinada (a soma pode incluir comissões
      // de outras execuções da mesma profissional no mês, então o valor é >= o desta).
      const { data: despesas, error } = await admin
        .from("contas_pagar")
        .select("valor_centavos, status, categoria")
        .eq("descricao", `Comissão — ${fx.profissional.nome} — ${competencia}`);
      if (error) throw error;
      expect(despesas?.length).toBeGreaterThan(0);
      expect(despesas!.every((d) => d.status === "paga" && d.categoria === "salario")).toBe(true);
      expect(Math.max(...despesas!.map((d) => d.valor_centavos))).toBeGreaterThanOrEqual(comissaoCentavos);

      // Aparece em Contas a pagar na mesma tela do Financeiro.
      await page.goto(`/financeiro?aba=pagar&periodo=ano`);
      await expect(page.getByTestId("conta-pagar").filter({ hasText: `Comissão — ${fx.profissional.nome}` }).first()).toBeVisible();
    } finally {
      await contexto.close();
    }
  });
});
