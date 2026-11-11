// Pagamento dividido e pacotes ponta a ponta (só viewport desktop: há um único caixa por dia).
// Roda contra o projeto Supabase de TESTES; sem E2E_PERMITIR_PROJETO/backend é pulado (Ruling R3).
// ATENÇÃO: a preparação TENTA apagar contas a receber, pagamentos, cobranças e o caixa de hoje (tolerante após a 0010: se não der, reaproveita o caixa aberto ou pula se fechado), sob a trava de e2e/trava-caixa.ts, e apaga os
// agendamentos (não cancelados) da profissional de teste hoje 13:00–14:00 e em dataEm(6)
// 10:00–11:00 — assim o spec roda de novo no mesmo dia. Clientes, serviços e pacotes criados
// ficam no projeto de testes.
import { expect, test } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { USUARIOS, pularSemBackend } from "./suporte";
import { TIMEOUT_PREPARACAO_MS, adquirirTravaCaixa } from "./trava-caixa";
import {
  clienteAdmin,
  entrar,
  prepararFicha,
  profissionalDeTeste,
  dataEm,
  type FixtureFicha,
} from "./ficha-suporte";

test.describe.configure({ mode: "serial" });

let admin: SupabaseClient;
let fx: FixtureFicha;
let liberarTrava: (() => Promise<void>) | null = null;
let caixaFechado = false;
let caixaNovo = true;
const hoje = dataEm(0);
const diaPacote = dataEm(6);

async function falhar(p: PromiseLike<{ error: unknown }>) {
  const { error } = await p;
  if (error) throw error;
}

test.beforeAll(async ({}, testInfo) => {
  test.skip(testInfo.project.name !== "computador", "E2E de cobrança roda só no desktop: há um único caixa por dia.");
  test.setTimeout(TIMEOUT_PREPARACAO_MS);
  await pularSemBackend("E2E da cobrança dividida");
  liberarTrava = await adquirirTravaCaixa();
  admin = clienteAdmin();
  // Tenta zerar o caixa de hoje (filhos primeiro). Após a 0010 não há delete em contas a
  // receber/recebimentos: falhas são ignoradas e o caixa existente é reaproveitado.
  const { data: caixa } = await admin.from("caixas").select("id").eq("data", hoje).maybeSingle();
  if (caixa) {
    const { data: pags } = await admin.from("pagamentos").select("id").eq("caixa_id", caixa.id);
    const ids = (pags ?? []).map((p) => p.id);
    if (ids.length) await admin.from("contas_receber").delete().in("pagamento_id", ids);
    await admin.from("pagamentos").delete().eq("caixa_id", caixa.id);
    await admin.from("cobrancas").delete().eq("caixa_id", caixa.id);
    await admin.from("caixas").delete().eq("id", caixa.id);
  }
  const { data: restante } = await admin.from("caixas").select("fechado_em").eq("data", hoje).maybeSingle();
  caixaNovo = !restante;
  caixaFechado = !!restante?.fechado_em;
  // Horários usados pelos testes, livres de execuções anteriores (restrição de sobreposição).
  const profissional = await profissionalDeTeste(admin);
  for (const [dia, de, ate] of [
    [hoje, "13:00", "14:00"],
    [diaPacote, "10:00", "11:00"],
  ]) {
    await falhar(
      admin
        .from("agendamentos")
        .delete()
        .eq("profissional_id", profissional.id)
        .neq("status", "cancelado")
        .gte("inicio", `${dia}T${de}:00-03:00`)
        .lt("inicio", `${dia}T${ate}:00-03:00`),
    );
  }
  fx = await prepararFicha(admin, "13");
  // Atendimento de hoje às 13:00 (a preparação usa hoje+5; move para hoje).
  await falhar(
    admin
      .from("agendamentos")
      .update({ inicio: `${hoje}T13:00:00-03:00`, fim: `${hoje}T14:00:00-03:00` })
      .eq("id", fx.agendamentoId),
  );
});

test.afterAll(async () => {
  await liberarTrava?.();
});

test("pagamento dividido: Pix menor, 'Falta' até fechar com Dinheiro; caixa mostra as duas partes", async ({ page }) => {
  test.skip(caixaFechado, "O caixa de hoje já está fechado e não pode ser apagado: nada a lançar.");
  await entrar(page, USUARIOS.recepcao.email, USUARIOS.recepcao.senha);
  await page.goto(`/agenda?data=${hoje}&visao=dia&prof=${fx.profissional.id}`);
  await page.getByRole("button", { name: new RegExp(`^13:00 ${fx.cliente.nome}`) }).click();
  await page.getByRole("button", { name: "Marcar como atendido" }).click();

  const dialogo = page.getByRole("dialog", { name: "Pagamento do atendimento" });
  await expect(dialogo).toBeVisible();
  if (caixaNovo) await dialogo.getByRole("button", { name: "Abrir caixa agora" }).click();
  await expect(dialogo.getByTestId("total-atendimento")).toHaveText(/R\$\s*100,00/);

  await dialogo.getByLabel("Forma de pagamento").selectOption("pix");
  await dialogo.getByLabel("Valor", { exact: true }).fill("70,00");
  await expect(dialogo.getByTestId("saldo-cobranca")).toHaveText(/Falta R\$\s*30,00/);
  await expect(dialogo.getByRole("button", { name: "Confirmar" })).toBeDisabled();

  await dialogo.getByRole("button", { name: "+ Adicionar outra forma" }).click();
  const segunda = dialogo.getByRole("group", { name: "Forma 2" });
  await expect(segunda.getByLabel("Valor", { exact: true })).toHaveValue("30,00");
  await segunda.getByLabel("Forma de pagamento").selectOption("dinheiro");
  await expect(dialogo.getByTestId("saldo-cobranca")).toHaveText("Valor fechado");
  await dialogo.getByRole("button", { name: "Confirmar" }).click();
  await expect(dialogo).toBeHidden();

  await page.goto("/caixa");
  const linha = page.getByRole("row", { name: new RegExp(fx.cliente.nome) });
  await expect(linha.first()).toBeVisible();
  await expect(linha.first()).toContainText(/R\$\s*70,00/);
  await expect(linha.first()).toContainText(/R\$\s*30,00/);
  await expect(linha.first().getByText("Pix")).toBeVisible();
  await expect(linha.first().getByText("Dinheiro")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Resumo" })).toBeVisible();

  // O atendimento já pago não volta a oferecer "Lançar pagamento". Controle positivo: a
  // página e o cartão carregaram (senão a ausência abaixo passaria por engano).
  await page.goto("/inicio");
  await expect(page.getByRole("heading", { name: "Atendidos sem pagamento" })).toBeVisible();
  await expect(page.getByText(fx.cliente.nome)).toHaveCount(0);
});

test("pacote: venda dividida na ficha e 'Usar sessão do pacote' na agenda", async ({ page }) => {
  test.skip(caixaFechado, "O caixa de hoje já está fechado e não pode ser apagado: nada a lançar.");
  await entrar(page, USUARIOS.recepcao.email, USUARIOS.recepcao.senha);
  await page.goto(`/clientes/${fx.cliente.id}?aba=pacotes`);
  await page.getByRole("button", { name: "Vender pacote" }).click();
  const dialogo = page.getByRole("dialog", { name: "Vender pacote" });
  const opcaoServico = dialogo.getByLabel("Serviço").locator("option", { hasText: fx.servicoNome });
  await dialogo.getByLabel("Serviço").selectOption((await opcaoServico.first().getAttribute("value"))!);
  await dialogo.getByLabel("Número de sessões").fill("3");
  await dialogo.getByLabel("Valor total").fill("250,00");
  await dialogo.getByRole("button", { name: "Continuar" }).click();
  await dialogo.getByLabel("Forma de pagamento").selectOption("pix");
  await expect(dialogo.getByTestId("saldo-cobranca")).toHaveText("Valor fechado");
  await dialogo.getByRole("button", { name: "Confirmar venda" }).click();
  await expect(dialogo).toBeHidden();
  await expect(page.getByText("0/3 sessões usadas")).toBeVisible();

  // Novo agendamento da cliente: a caixa de seleção do pacote aparece.
  await page.goto(`/agenda?data=${diaPacote}&visao=dia&prof=${fx.profissional.id}`);
  await page.getByRole("button", { name: `Agendar ${fx.profissional.nome} às 10:00` }).click();
  const novo = page.getByRole("dialog");
  await novo.getByLabel("Cliente").fill(fx.cliente.nome);
  await novo.getByRole("button", { name: new RegExp(fx.cliente.nome) }).click();
  const servico = novo.getByLabel("Serviço");
  const valor = await servico.locator("option", { hasText: fx.servicoNome }).first().getAttribute("value");
  await servico.selectOption(valor!);
  const usar = novo.getByLabel(/Usar sessão do pacote/);
  await expect(usar).toBeVisible();
  await usar.check();
  await novo.getByRole("button", { name: "Salvar" }).click();
  await expect(page.getByRole("button", { name: new RegExp(`^10:00 ${fx.cliente.nome}.*pacote 1 de 3`) })).toBeVisible();
});
