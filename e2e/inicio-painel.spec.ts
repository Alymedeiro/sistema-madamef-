// Painel do Início: sem rolagem horizontal nos 3 tamanhos; recepção não vê valores em dinheiro.
import { expect, test } from "@playwright/test";
import { ARQUIVO_ESTADO, pularSemBackend } from "./suporte";

test.beforeAll(async () => {
  await pularSemBackend("E2E do painel do Início");
});

const semRolagem = (page: import("@playwright/test").Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

test.describe("dona", () => {
  test.use({ storageState: ARQUIVO_ESTADO("dona") });

  test("painel completo sem rolagem horizontal", async ({ page }) => {
    await page.goto("/inicio");
    await expect(page.getByText("Faturamento do mês")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Faturamento — últimos 30 dias" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Atendimentos da semana" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Agenda de hoje" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Alertas" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "CRM" })).toBeVisible();
    expect(await semRolagem(page)).toBe(true);
  });
});

test.describe("recepção", () => {
  test.use({ storageState: ARQUIVO_ESTADO("recepcao") });

  test("não vê faturamento nem ticket médio e não rola na horizontal", async ({ page }) => {
    await page.goto("/inicio");
    await expect(page.getByRole("heading", { name: "Agenda de hoje" })).toBeVisible();
    await expect(page.getByText("Faturamento")).toHaveCount(0);
    await expect(page.getByText("Ticket médio")).toHaveCount(0);
    expect(await semRolagem(page)).toBe(true);
  });
});
