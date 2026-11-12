// Painel do Início nos 3 tamanhos (390/1024/1440, os projetos do Playwright): sem rolagem
// horizontal para dona, recepção e profissional; a recepção não vê valores em dinheiro; a
// profissional não vê dinheiro nem o CRM e só enxerga os próprios atendimentos.
import { expect, test, type Page } from "@playwright/test";
import { ARQUIVO_ESTADO, pularSemBackend } from "./suporte";

test.beforeAll(async () => {
  await pularSemBackend("E2E do painel do Início");
});

const semRolagem = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

const DINHEIRO = ["Faturamento", "Ticket médio"];

test.describe("dona", () => {
  test.use({ storageState: ARQUIVO_ESTADO("dona") });

  test("painel completo sem rolagem horizontal", async ({ page }) => {
    await page.goto("/inicio");
    await expect(page.getByText("Faturamento do mês")).toBeVisible();
    await expect(page.getByText("Ticket médio do mês")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Faturamento — últimos 30 dias" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Atendimentos da semana" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Agenda de hoje" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Alertas" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "CRM" })).toBeVisible();
    expect(await semRolagem(page)).toBe(true);
  });

  test("os gráficos têm rótulos em HTML (sem texto esticado) e tabela para leitores de tela", async ({ page }) => {
    await page.goto("/inicio");
    const grafico = page.getByRole("region", { name: "Faturamento — últimos 30 dias" });
    await expect(grafico.locator("svg text")).toHaveCount(0);
    await expect(grafico.locator("table.sr-only tbody tr")).toHaveCount(30);
    const semana = page.getByRole("region", { name: "Atendimentos da semana" });
    await expect(semana.locator("table.sr-only tbody tr")).toHaveCount(7);
    await expect(semana.getByText("seg", { exact: true })).toBeVisible();
    expect(await semRolagem(page)).toBe(true);
  });
});

test.describe("recepção", () => {
  test.use({ storageState: ARQUIVO_ESTADO("recepcao") });

  test("não vê faturamento nem ticket médio, vê o CRM e não rola na horizontal", async ({ page }) => {
    await page.goto("/inicio");
    await expect(page.getByRole("heading", { name: "Agenda de hoje" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "CRM" })).toBeVisible();
    for (const texto of DINHEIRO) await expect(page.getByText(texto)).toHaveCount(0);
    await expect(page.getByRole("heading", { name: /Faturamento/ })).toHaveCount(0);
    expect(await semRolagem(page)).toBe(true);
  });
});

test.describe("profissional", () => {
  test.use({ storageState: ARQUIVO_ESTADO("profissional") });

  test("sem dinheiro nem CRM, só os próprios atendimentos, sem rolagem horizontal", async ({ page }) => {
    await page.goto("/inicio");
    await expect(page.getByRole("heading", { name: "Agenda de hoje" })).toBeVisible();
    await expect(page.getByText("Atendimentos hoje")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Atendimentos da semana" })).toBeVisible();
    for (const texto of DINHEIRO) await expect(page.getByText(texto)).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "CRM" })).toHaveCount(0);
    await expect(page.getByText("Pedidos online")).toHaveCount(0);
    await expect(page.getByText("Respostas para ler")).toHaveCount(0);

    // Só os próprios atendimentos (a RLS filtra): a contagem do cartão bate com a lista de hoje.
    const agenda = page.getByRole("region", { name: "Agenda de hoje" });
    const itens = await agenda.getByRole("listitem").count();
    await expect(page.locator('[data-kpi="atendimentos-hoje"]')).toContainText(new RegExp(`^Atendimentos hoje\\s*${itens}`));
    expect(await semRolagem(page)).toBe(true);
  });
});
