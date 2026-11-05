// Componentes da ficha que rodam só no navegador (sem backend): campo de assinatura e
// conversor de foto. Usam a página de apoio /e2e-harness, que só existe no build do
// Playwright (NEXT_PUBLIC_E2E_HARNESS=1). Se a rota não existir (E2E_BASE_URL externo), pula.
import { expect, test, type Page } from "@playwright/test";
import sharp from "sharp";

async function abrirHarness(page: Page) {
  const r = await page.goto("/e2e-harness");
  test.skip(r?.status() === 404, "Página /e2e-harness indisponível neste build.");
  await expect(page.getByRole("heading", { name: "Harness de testes" })).toBeVisible();
}

test("assinatura: desenha com o mouse, Limpar volta ao vazio", async ({ page, isMobile }) => {
  test.skip(!!isMobile, "Desenho com mouse não se aplica ao celular (veja o teste de toque).");
  await abrirHarness(page);
  const area = page.getByRole("img", { name: "Área de assinatura" });
  const caixa = (await area.boundingBox())!;
  const x = caixa.x;
  const y = caixa.y;
  await expect(page.getByTestId("assinatura-estado")).toHaveText("vazia");
  await page.mouse.move(x + 30, y + 60);
  await page.mouse.down();
  await page.mouse.move(x + 90, y + 140, { steps: 8 });
  await page.mouse.move(x + 160, y + 80, { steps: 8 });
  await page.mouse.up();
  await expect(page.getByTestId("assinatura-estado")).toHaveText("assinada");
  await page.getByRole("button", { name: "Limpar" }).click();
  await expect(page.getByTestId("assinatura-estado")).toHaveText("vazia");
});

test("assinatura: desenha por toque e Limpar volta ao vazio", async ({ page }) => {
  await abrirHarness(page);
  const area = page.getByRole("img", { name: "Área de assinatura" });
  const caixa = (await area.boundingBox())!;
  const ponto = (dx: number, dy: number, id = 1) => ({
    x: caixa.x + dx,
    y: caixa.y + dy,
    id,
  });
  const cdp = await page.context().newCDPSession(page);
  const toque = (type: "touchStart" | "touchMove" | "touchEnd",  pontos: ReturnType<typeof ponto>[]) =>
    cdp.send("Input.dispatchTouchEvent", { type, touchPoints: pontos });
  await toque("touchStart", [ponto(30, 60)]);
  await toque("touchMove", [ponto(90, 140)]);
  await toque("touchMove", [ponto(150, 80)]);
  await toque("touchEnd", []);
  await expect(page.getByTestId("assinatura-estado")).toHaveText("assinada");
  await page.getByRole("button", { name: "Limpar" }).click();
  await expect(page.getByTestId("assinatura-estado")).toHaveText("vazia");
});

test("conversor: JPEG 6000x4000 vira no máximo 2560 px e 5 MB", async ({ page }) => {
  test.setTimeout(120_000);
  await abrirHarness(page);
  const grande = await sharp({
    create: { width: 6000, height: 4000, channels: 3, background: "#b08850", noise: { type: "gaussian", mean: 128, sigma: 30 } },
  })
    .jpeg({ quality: 90 })
    .toBuffer();
  await page.getByLabel("Arquivo").setInputFiles({ name: "grande.jpg", mimeType: "image/jpeg", buffer: grande });
  const saida = page.getByTestId("conversao-resultado");
  await expect(saida).toHaveText(/^ok image\/jpeg \d+x\d+ \d+$/, { timeout: 90_000 });
  const [, , dim, bytes] = ((await saida.textContent()) ?? "").split(" ");
  const [w, h] = dim.split("x").map(Number);
  expect(Math.max(w, h)).toBeLessThanOrEqual(2560);
  expect(Number(bytes)).toBeLessThanOrEqual(5 * 1024 * 1024);
  expect(w / h).toBeCloseTo(1.5, 1);
});

test("conversor: PDF é recusado com a mensagem amigável", async ({ page }) => {
  await abrirHarness(page);
  await page.getByLabel("Arquivo").setInputFiles({
    name: "documento.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4\n%%EOF"),
  });
  await expect(page.getByTestId("conversao-resultado")).toHaveText(
    "erro: Escolha uma foto (JPEG, PNG ou HEIC).",
  );
});
