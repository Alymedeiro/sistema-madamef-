// Ficha clínica ponta a ponta (anamnese e termo no tablet, fotos, evolução, acessos).
// Roda contra o projeto Supabase de TESTES; sem E2E_PERMITIR_PROJETO/backend é pulado (Ruling R3).
// Cada viewport usa um horário próprio (8h/9h/10h em hoje+5) e cria cliente, serviço e termo novos.
import { expect, test } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { USUARIOS, pularSemBackend } from "./suporte";
import {
  assinar,
  clienteAdmin,
  entrar,
  prepararFicha,
  semearFotos,
  type FixtureFicha,
} from "./ficha-suporte";

test.describe.configure({ mode: "serial" });

let admin: SupabaseClient;
let fx: FixtureFicha;

test.beforeAll(async ({}, testInfo) => {
  await pularSemBackend("E2E da ficha clínica");
  admin = clienteAdmin();
  const indice = Math.max(0, ["computador", "tablet", "celular"].indexOf(testInfo.project.name));
  fx = await prepararFicha(admin, String(8 + indice));
});

test.describe("fluxos completos (computador e tablet)", () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name === "celular", "No celular só a comparação de fotos é testada.");
  });

  test("anamnese no tablet: obrigatórias, assinatura e alerta na ficha", async ({ page }) => {
    await entrar(page, USUARIOS.recepcao.email, USUARIOS.recepcao.senha);
    await page.goto(`/clientes/${fx.cliente.id}?aba=anamnese`);
    await page.getByRole("link", { name: "Preencher anamnese" }).click();
    await page.waitForURL("**/tablet/anamnese/**");
    // Modo tablet: sem o menu do sistema.
    await expect(page.getByRole("link", { name: "Agenda" })).toHaveCount(0);

    const respostas: Record<string, string> = {
      "Qual é a sua principal queixa ou objetivo?": "Manchas no rosto",
      "Tem alguma alergia (medicamentos, cosméticos, alimentos)?": "Não",
      "Está grávida ou amamentando?": "Sim",
      "Usa algum medicamento contínuo?": "Não",
      "Usa anticoagulante?": "Não",
    };
    for (let i = 0; i < 30; i++) {
      const titulo = ((await page.getByRole("heading", { level: 2 }).first().textContent()) ?? "")
        .replace(/\s*\*$/, "")
        .trim();
      if (titulo === "Suas respostas") break;
      const r = respostas[titulo];
      if (r === "Manchas no rosto") await page.getByLabel(titulo).fill(r);
      else if (r) await page.getByRole("button", { name: r, exact: true }).click();
      await page.getByRole("button", { name: /^(Próxima|Revisar)$/ }).click();
    }
    await expect(page.getByRole("heading", { name: "Suas respostas" })).toBeVisible();
    await assinar(page);
    await page.getByRole("button", { name: "Confirmar" }).click();

    await page.waitForURL(/\/clientes\/.+aba=anamnese/);
    const alerta = page.getByRole("alert").filter({ hasText: "⚠ Atenção" });
    await expect(alerta).toBeVisible();
    await expect(alerta).toContainText("Está grávida ou amamentando?");
  });

  test("termo: colhido pelo atendimento, listado e PDF abre com token", async ({ page, context }) => {
    await entrar(page, USUARIOS.recepcao.email, USUARIOS.recepcao.senha);
    await page.goto(`/agenda?data=${fx.data}&visao=dia&prof=${fx.profissional.id}`);
    await page
      .getByRole("button", { name: new RegExp(`^${fx.hora}:00 ${fx.cliente.nome}.*termo pendente`) })
      .click();
    await page.getByRole("link", { name: "Colher assinatura" }).click();
    await page.waitForURL("**/tablet/termo/**");
    await assinar(page);
    await page.getByText("Li e concordo").click();
    await page.getByRole("button", { name: "Confirmar" }).click();
    await page.waitForURL("**/agenda**");

    await page.goto(`/clientes/${fx.cliente.id}?aba=termos`);
    await expect(page.getByRole("heading", { name: new RegExp("Termo E2E") })).toBeVisible();
    const [popup] = await Promise.all([
      context.waitForEvent("page"),
      page.getByRole("button", { name: "Abrir PDF" }).first().click(),
    ]);
    await expect.poll(() => popup.url(), { timeout: 15_000 }).toContain("token=");
    const resposta = await page.request.get(popup.url());
    expect(resposta.status()).toBe(200);
    expect(resposta.headers()["content-type"]).toContain("application/pdf");
    await popup.close();
  });

  test("profissional envia foto-1 (antes) e foto-2 (depois) pela Galeria", async ({ page }) => {
    await entrar(page, USUARIOS.profissional.email, USUARIOS.profissional.senha);
    await page.goto(`/clientes/${fx.cliente.id}?aba=fotos`);
    for (const [arquivo, tipo, total] of [
      ["foto-1.jpg", "antes", 1],
      ["foto-2.jpg", "depois", 2],
    ] as const) {
      await page.getByLabel("Tipo", { exact: true }).selectOption(tipo);
      await page.getByLabel("Escolher fotos da galeria").setInputFiles(`e2e/fixtures/${arquivo}`);
      await expect(page.getByRole("button", { name: /^(Antes|Depois), \d\d\/\d\d\/\d{4}/ })).toHaveCount(total, {
        timeout: 30_000,
      });
    }
  });

  test("profissional registra e edita uma evolução", async ({ page }) => {
    await entrar(page, USUARIOS.profissional.email, USUARIOS.profissional.senha);
    await page.goto(`/clientes/${fx.cliente.id}?aba=evolucoes`);
    await page.getByLabel("Evolução / observações").fill("Pele sensível, sem reação.");
    await page.getByRole("button", { name: "Salvar evolução" }).click();
    await expect(page.getByText("Pele sensível, sem reação.")).toBeVisible();
    await page.getByRole("button", { name: "Editar" }).first().click();
    await page.getByLabel("Editar evolução").fill("Pele sensível, leve vermelhidão.");
    await page.getByRole("button", { name: "Salvar", exact: true }).click();
    await expect(page.getByText("Pele sensível, leve vermelhidão.")).toBeVisible();
  });

  test("recepção não vê a aba Fotos", async ({ page }) => {
    await entrar(page, USUARIOS.recepcao.email, USUARIOS.recepcao.senha);
    await page.goto(`/clientes/${fx.cliente.id}`);
    const abas = page.getByRole("navigation", { name: "Seções da ficha" });
    await expect(abas.getByRole("link", { name: "Anamnese" })).toBeVisible();
    await expect(abas.getByRole("link", { name: "Fotos" })).toHaveCount(0);
  });

  test("dona vê o registro de acessos com 'Visualizou · Anamnese'", async ({ page }) => {
    await entrar(page, USUARIOS.dona.email, USUARIOS.dona.senha);
    // A leitura da anamnese pela própria dona também é auditada.
    await page.goto(`/clientes/${fx.cliente.id}?aba=anamnese`);
    await page.goto(`/configuracoes/acessos?cliente=${fx.cliente.id}`);
    await expect(page.getByRole("heading", { name: "Registro de acessos" })).toBeVisible();
    await expect(page.getByRole("row", { name: /Visualizou\s+Anamnese/ }).first()).toBeVisible();
  });
});

test("comparar fotos: lado a lado (≥640 px) ou empilhadas (celular)", async ({ page }, testInfo) => {
  await semearFotos(admin, fx);
  await entrar(page, USUARIOS.profissional.email, USUARIOS.profissional.senha);
  await page.goto(`/clientes/${fx.cliente.id}?aba=fotos`);
  await page.getByRole("button", { name: "Comparar", exact: true }).click();
  await page.getByRole("button", { name: /^Antes, / }).first().click();
  await page.getByRole("button", { name: /^Depois, / }).first().click();
  await page.getByRole("button", { name: "Ver lado a lado" }).click();

  const dialogo = page.getByRole("dialog", { name: "Comparar fotos" });
  const imagens = dialogo.getByRole("img");
  await expect(imagens).toHaveCount(2);
  for (const i of [0, 1]) {
    await expect(imagens.nth(i)).toBeVisible();
    await expect
      .poll(() => imagens.nth(i).evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0))
      .toBe(true);
  }
  const a = (await imagens.nth(0).boundingBox())!;
  const b = (await imagens.nth(1).boundingBox())!;
  if (testInfo.project.name === "celular") {
    expect(b.y).toBeGreaterThan(a.y + a.height - 1); // empilhadas
  } else {
    expect(Math.abs(a.y - b.y)).toBeLessThan(2); // lado a lado
    expect(b.x).toBeGreaterThan(a.x + a.width - 1);
  }
});
