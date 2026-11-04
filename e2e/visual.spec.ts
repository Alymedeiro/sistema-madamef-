// Teste de tela nos 3 viewports (computador 1440, tablet 1024, celular 390) das
// páginas públicas, que não precisam de backend: renderiza, mostra o logo, não
// rola na horizontal e o manifest do PWA está declarado.
import { expect, test } from "@playwright/test";

const PAGINAS = [
  { caminho: "/login", titulo: /Entrar|Madame/i },
  { caminho: "/esqueci-senha", titulo: /senha/i },
  // Link de convite: o GET só mostra "Continuar" (não consome o token).
  { caminho: "/auth/confirmar?token_hash=abc_123&type=invite", titulo: /Ative o seu acesso/i },
];

for (const { caminho, titulo } of PAGINAS) {
  test(`${caminho}: renderiza, logo visível, sem rolagem horizontal e com manifest`, async ({ page }) => {
    const resposta = await page.goto(caminho);
    expect(resposta?.status()).toBe(200);
    await expect(page.getByRole("heading", { name: titulo }).first()).toBeVisible();

    const logo = page.locator('img[src*="logo-madame-fe"]').first();
    await expect(logo).toBeVisible();
    expect(await logo.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);

    const semOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    );
    expect(semOverflow).toBe(true);

    await expect(page.locator('link[rel="manifest"]')).toHaveAttribute("href", /manifest/);
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", "#986818");
  });
}

test("/auth/confirmar: GET mostra o botão Continuar; link inválido volta ao login", async ({ page }) => {
  await page.goto("/auth/confirmar?token_hash=abc_123&type=recovery");
  await expect(page.getByRole("button", { name: "Continuar" })).toBeVisible();
  await expect(page).toHaveURL(/\/auth\/confirmar/);

  await page.goto("/auth/confirmar?token_hash=abc_123&type=signup");
  await expect(page).toHaveURL(/\/login\?motivo=link-invalido/);
});

test("manifest do PWA é servido com os valores esperados", async ({ request }) => {
  const r = await request.get("/manifest.webmanifest");
  expect(r.status()).toBe(200);
  const m = await r.json();
  expect(m).toMatchObject({
    name: "Madame Fê Clinic",
    short_name: "Madame Fê",
    start_url: "/inicio",
    display: "standalone",
    background_color: "#FEEDF3",
    theme_color: "#986818",
  });
  expect(m.icons.map((i: { purpose: string }) => i.purpose)).toEqual(["any", "any", "maskable"]);
  for (const i of m.icons) expect((await request.get(i.src)).status()).toBe(200);
});
