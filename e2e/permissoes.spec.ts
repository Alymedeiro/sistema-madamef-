// Permissões por perfil no menu e nas rotas (Task 14). Usa o storageState salvo por
// auth.setup.ts; sem backend de teste o arquivo é pulado com mensagem explícita.
import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { ARQUIVO_ESTADO, ARQUIVO_FIXTURES, pularSemBackend } from "./suporte";

test.beforeAll(async () => {
  await pularSemBackend("E2E de permissões");
});

test.describe("recepção", () => {
  test.use({ storageState: ARQUIVO_ESTADO("recepcao") });

  test("não vê Equipe nem Configurações e /equipe volta para /inicio", async ({ page }) => {
    await page.goto("/inicio");
    await expect(page.getByRole("link", { name: "Agenda" }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: "Equipe" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Configurações" })).toHaveCount(0);
    await page.goto("/equipe");
    await expect(page).toHaveURL(/\/inicio$/);
  });
});

test.describe("profissional", () => {
  test.use({ storageState: ARQUIVO_ESTADO("profissional") });

  test("não vê Caixa e /caixa volta para /inicio", async ({ page }) => {
    await page.goto("/inicio");
    await expect(page.getByRole("link", { name: "Agenda" }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: "Caixa" })).toHaveCount(0);
    await page.goto("/caixa");
    await expect(page).toHaveURL(/\/inicio$/);
  });

  test("cliente de outra profissional dá 404", async ({ page }) => {
    const { clienteDeOutraProfissionalId } = JSON.parse(await readFile(ARQUIVO_FIXTURES, "utf8"));
    const resposta = await page.goto(`/clientes/${clienteDeOutraProfissionalId}`);
    expect(resposta?.status()).toBe(404);
  });
});

test.describe("dona no celular", () => {
  test.use({ storageState: ARQUIVO_ESTADO("dona") });

  test("barra inferior sem rolagem: 4 itens + Mais com o resto", async ({ page }, info) => {
    test.skip(info.project.name !== "celular", "Barra inferior só aparece abaixo de 1024 px");
    await page.goto("/inicio");
    const barra = page.locator("nav[aria-label='Menu principal']").last();
    for (const nome of ["Início", "Agenda", "Clientes", "Caixa"]) {
      await expect(barra.getByRole("link", { name: nome })).toBeVisible();
    }
    await expect(barra.getByRole("link", { name: "Equipe" })).toHaveCount(0);
    expect(await barra.evaluate((n) => n.scrollWidth <= n.clientWidth)).toBe(true);

    await barra.getByRole("button", { name: "Mais" }).click();
    await barra.getByRole("link", { name: "Equipe" }).click();
    await expect(page).toHaveURL(/\/equipe$/);
  });
});
