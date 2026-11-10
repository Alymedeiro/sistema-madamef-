// Financeiro ponta a ponta (contas fixas, pagar, receber na recepção, período, PDF, sininho),
// nos 3 tamanhos. Roda contra o projeto Supabase de TESTES já com a 0010 aplicada; sem
// E2E_PERMITIR_PROJETO/backend é pulado (Ruling R3).
// ATENÇÃO: contas a pagar/receber, recebimentos e contas fixas não têm "delete" (nem para o
// service_role), então a limpeza só CANCELA o que ficou em aberto (contas_pagar,
// contas_receber) e desativa a conta fixa; contas pagas, o recebimento, a cliente de teste e
// as linhas de avisos_lidos ficam no projeto de testes. Dados únicos por execução e viewport
// (prefixo "E2E Financeiro"). Se hoje ainda não há caixa, a preparação abre um (valor inicial
// 0) e ele fica: o recebimento da parcela o referencia e o banco não permite apagar.
// Como o caixa de hoje e os avisos são globais, os 3 viewports e os specs caixa/cobranca se
// revezam pela trava compartilhada de e2e/trava-caixa.ts (nunca rodam ao mesmo tempo).
import { expect, test, type Page } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ARQUIVO_ESTADO, USUARIOS, pularSemBackend } from "./suporte";
import { clienteAdmin, dataEm } from "./ficha-suporte";
import { TIMEOUT_PREPARACAO_MS, adquirirTravaCaixa } from "./trava-caixa";

test.describe.configure({ mode: "serial" });

const VIEWPORTS = ["computador", "tablet", "celular"];
const TIMEZONE = "America/Sao_Paulo";

let admin: SupabaseClient;
let liberarTrava: (() => Promise<void>) | null = null;
let indice = 0;
let prefixo = "";
let donaId = "";
let caixaAberto = false;
let clienteId = "";
let clienteNome = "";
let contaReceberId = "";
let valorCentavos = 0;
const hoje = dataEm(0);

const descricaoFixa = () => `${prefixo} fixa`;
const descricaoAviso = () => `${prefixo} aviso`;
const descricaoReceber = () => `${prefixo} parcela`;

async function falhar(p: PromiseLike<{ error: unknown }>) {
  const { error } = await p;
  if (error) throw error;
}

async function colaboradorDe(email: string): Promise<string> {
  const { data: lista, error } = await admin.auth.admin.listUsers({ perPage: 1000 });
  if (error) throw error;
  const u = lista.users.find((x) => x.email?.toLowerCase() === email.toLowerCase());
  if (!u) throw new Error(`Usuário ${email} não existe no projeto de teste.`);
  const { data, error: ec } = await admin.from("colaboradores").select("id").eq("usuario_auth_id", u.id).single();
  if (ec) throw ec;
  return data.id as string;
}

/** Centavos de um valor "R$ 1.234,56" (aceita espaços não separáveis). */
const centavosDe = (texto: string) => Number(texto.replace(/\D/g, ""));

async function valorDoCartao(page: Page, titulo: string): Promise<number> {
  const cartao = page.getByRole("region", { name: titulo, exact: true });
  await expect(cartao).toBeVisible();
  return centavosDe((await cartao.locator("p").first().innerText()) ?? "");
}

test.beforeAll(async ({}, testInfo) => {
  test.setTimeout(TIMEOUT_PREPARACAO_MS);
  await pularSemBackend("E2E do Financeiro");
  admin = clienteAdmin();
  indice = Math.max(0, VIEWPORTS.indexOf(testInfo.project.name));
  liberarTrava = await adquirirTravaCaixa();

  prefixo = `E2E Financeiro ${VIEWPORTS[indice]} ${Date.now()}`;
  valorCentavos = 12345 + indice;
  donaId = await colaboradorDe(USUARIOS.dona.email);

  // Caixa de hoje: reaproveita o aberto; sem caixa, abre um; fechado, o teste de receber é pulado.
  const { data: caixa, error: ecx } = await admin.from("caixas").select("id, fechado_em").eq("data", hoje).maybeSingle();
  if (ecx) throw ecx;
  if (!caixa) {
    await falhar(admin.from("caixas").insert({ data: hoje, aberto_por: donaId, valor_inicial_centavos: 0 }));
    caixaAberto = true;
  } else {
    caixaAberto = !caixa.fechado_em;
  }

  // Parcela manual que vence hoje, de uma cliente nova.
  clienteNome = `Cliente ${prefixo}`;
  const { data: cliente, error: ec } = await admin
    .from("clientes")
    .insert({ nome: clienteNome, aceite_lgpd_em: new Date().toISOString() })
    .select("id")
    .single();
  if (ec) throw ec;
  clienteId = cliente.id;
  const { data: receber, error: er } = await admin
    .from("contas_receber")
    .insert({
      cliente_id: clienteId,
      numero: 1,
      total_parcelas: 1,
      valor_centavos: 5000 + indice,
      vencimento: hoje,
      descricao: descricaoReceber(),
      origem_manual: true,
      lancada_por: donaId,
    })
    .select("id")
    .single();
  if (er) throw er;
  contaReceberId = receber.id;

  // Conta a pagar que vence em 3 dias: gera o aviso do sininho.
  const { error: ea } = await admin
    .from("contas_pagar")
    .insert({
      descricao: descricaoAviso(),
      categoria: "outros",
      valor_centavos: 7700 + indice,
      vencimento: dataEm(3),
      lancada_por: donaId,
    });
  if (ea) throw ea;
});

test.afterAll(async () => {
  try {
    if (liberarTrava && admin) {
      const cancelamento = {
        cancelada_motivo: "Limpeza do E2E",
        cancelada_em: new Date().toISOString(),
        cancelada_por: donaId,
      };
      // Só o que ficou em aberto; erros de limpeza não derrubam o spec.
      await admin
        .from("contas_pagar")
        .update({ status: "cancelada", ...cancelamento })
        .eq("status", "aberta")
        .like("descricao", `${prefixo}%`);
      await admin
        .from("contas_receber")
        .update(cancelamento)
        .is("recebido_em", null)
        .is("cancelada_em", null)
        .like("descricao", `${prefixo}%`);
      await admin.from("contas_fixas").update({ ativa: false }).like("descricao", `${prefixo}%`);
    }
  } finally {
    await liberarTrava?.();
  }
});

test.describe("dona", () => {
  test.use({ storageState: ARQUIVO_ESTADO("dona") });

  test("cria conta fixa e vê a conta do mês; marcar paga muda o cartão Pago", async ({ page }) => {
    await page.goto("/financeiro?aba=pagar");
    await expect(page.getByRole("heading", { name: "Financeiro", level: 1 })).toBeVisible();

    await page.getByRole("button", { name: "Novo lançamento" }).click();
    await page.getByRole("dialog", { name: "Novo lançamento" }).getByRole("button", { name: "Conta a pagar" }).click();
    const dialogo = page.getByRole("dialog", { name: "Nova conta a pagar" });
    await dialogo.getByLabel("Descrição").fill(descricaoFixa());
    await dialogo.getByLabel("Categoria").selectOption({ label: "Outros" });
    await dialogo.getByLabel("Valor (R$)").fill(`123,${String(45 + indice).padStart(2, "0")}`);
    await dialogo.getByLabel("Repete todo mês").check();
    await dialogo.getByLabel("Vence todo mês no dia").selectOption(String(Number(hoje.slice(8, 10))));
    await dialogo.getByRole("button", { name: "Salvar" }).click();
    await expect(dialogo).toBeHidden();

    const linha = page.getByTestId("conta-pagar").filter({ hasText: descricaoFixa() });
    await expect(linha).toHaveCount(1);
    await expect(linha).toContainText("(todo mês)");
    await expect(linha).toContainText("Em aberto");
    await expect(page.getByRole("region", { name: "Contas fixas (todo mês)" })).toContainText(descricaoFixa());

    const pagoAntes = await valorDoCartao(page, "Pago");
    await linha.getByRole("button", { name: "Marcar como paga" }).click();
    const pagar = page.getByRole("dialog", { name: "Marcar como paga" });
    await pagar.getByRole("button", { name: "Confirmar pagamento" }).click();
    await expect(pagar).toBeHidden();
    await expect(linha).toContainText("Paga");
    await expect.poll(() => valorDoCartao(page, "Pago")).toBe(pagoAntes + valorCentavos);
  });

  test("filtro 'Mês passado' muda o rótulo do período", async ({ page }) => {
    await page.goto("/financeiro");
    const rotulo = page.getByTestId("periodo-rotulo");
    const atual = (await rotulo.innerText()).trim();
    await page.getByRole("link", { name: "Mês passado" }).click();
    await expect(page).toHaveURL(/periodo=mes_passado/);
    await expect(rotulo).not.toHaveText(atual);
    const passado = new Date(`${hoje.slice(0, 7)}-15T12:00:00-03:00`);
    passado.setMonth(passado.getMonth() - 1);
    const mes = new Intl.DateTimeFormat("pt-BR", { month: "long", timeZone: TIMEZONE }).format(passado);
    await expect(rotulo).toContainText(new RegExp(mes, "i"));
  });

  test("Exportar PDF (fora do Caixa do dia) baixa application/pdf", async ({ page }) => {
    await page.goto("/financeiro?aba=pagar");
    const exportar = page.getByRole("link", { name: "Exportar PDF" });
    await expect(exportar).toBeVisible();
    const href = await exportar.getAttribute("href");
    expect(href).toBeTruthy();
    const resposta = await page.request.get(href!);
    expect(resposta.status()).toBe(200);
    expect(resposta.headers()["content-type"]).toContain("application/pdf");
    expect((await resposta.body()).subarray(0, 4).toString()).toBe("%PDF");

    // Na aba Caixa do dia o botão não existe.
    await page.goto("/financeiro?aba=caixa");
    await expect(page.getByRole("heading", { name: "Financeiro", level: 1 })).toBeVisible();
    await expect(page.getByRole("link", { name: "Exportar PDF" })).toHaveCount(0);
  });

  test("sininho mostra o aviso e ele some após 'Marcar todos como lidos'", async ({ page }) => {
    await page.goto("/inicio");
    await page.getByRole("button", { name: /^Avisos: \d+ não lidos?$/ }).click();
    const lista = page.getByRole("region", { name: "Avisos de vencimento" });
    await expect(lista.getByRole("link", { name: new RegExp(`${prefixo} aviso — .* — vence em 3 dias`) })).toBeVisible();

    await lista.getByRole("button", { name: "Marcar todos como lidos" }).click();
    await expect(page.getByRole("button", { name: "Avisos: nenhum não lido" })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("button", { name: "Avisos: nenhum não lido" })).toBeVisible();
  });

  test("/caixa redireciona para /financeiro?aba=caixa", async ({ page }) => {
    await page.goto("/caixa");
    await expect(page).toHaveURL(/\/financeiro\?aba=caixa$/);
    await expect(page.getByRole("link", { name: "Caixa do dia" })).toHaveAttribute("aria-current", "page");
  });
});

test.describe("recepção", () => {
  test.use({ storageState: ARQUIVO_ESTADO("recepcao") });

  test("abrindo ?aba=painel&periodo=ano vê só o Caixa do dia, sem cartões nem abas", async ({ page }) => {
    await page.goto("/financeiro?aba=painel&periodo=ano");
    await expect(page.getByRole("heading", { name: "Caixa do dia", level: 1 })).toBeVisible();
    for (const titulo of ["Recebido", "Pago", "Saldo em caixa", "A receber", "A pagar", "Saldo projetado", "Vencidos"]) {
      await expect(page.getByRole("region", { name: titulo, exact: true })).toHaveCount(0);
    }
    await expect(page.getByRole("navigation", { name: "Seções do financeiro" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Novo lançamento" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Exportar PDF" })).toHaveCount(0);
  });

  test("não baixa o PDF por URL direta (403)", async ({ page }) => {
    const resposta = await page.request.get("/financeiro/exportar?aba=pagar");
    expect(resposta.status()).toBe(403);
  });

  test("/caixa redireciona e a recepção recebe uma parcela no caixa de hoje", async ({ page }) => {
    test.skip(!caixaAberto, "O caixa de hoje já está fechado: não dá para receber a parcela.");
    await page.goto("/caixa");
    await expect(page).toHaveURL(/\/financeiro\?aba=caixa$/);

    const linha = page.getByTestId("parcela-receber").filter({ hasText: clienteNome });
    await expect(linha).toHaveCount(1);
    await linha.getByRole("button", { name: "Receber" }).click();
    const dialogo = page.getByRole("dialog", { name: "Receber parcela" });
    await dialogo.getByRole("button", { name: "Confirmar recebimento" }).click();
    await expect(dialogo).toBeHidden();
    await expect(page.getByTestId("parcela-receber").filter({ hasText: clienteNome })).toHaveCount(0);

    const { data } = await admin.from("recebimentos").select("valor_centavos").eq("conta_receber_id", contaReceberId);
    expect(data).toEqual([{ valor_centavos: 5000 + indice }]);
  });
});
