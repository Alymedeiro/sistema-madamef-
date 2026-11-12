// WhatsApp ponta a ponta (Fase 3B), nos 3 tamanhos. Roda contra o projeto Supabase de TESTES
// já com a 0012 aplicada; sem E2E_PERMITIR_PROJETO/backend é pulado (Ruling R3).
// ATENÇÃO: nada é apagado. fila_mensagens e mensagens_recebidas não têm "delete" nem "update"
// para o service_role (só as funções security definer mexem): a mensagem avulsa fica na fila
// como Cancelada, a resposta fica como lida, a cliente e o atendimento ficam no projeto de
// testes (cliente e telefone únicos por execução; o horário, em hoje+24, é liberado por
// prepararFicha).
// A resposta recebida entra por registrar_recebida (service role), como o webhook faz.
// O spec NUNCA deixa "Envio automático ativo" ligado (o projeto de testes não pode enviar):
// o afterAll grava whatsapp_ativo = false e devolve o texto original do modelo editado. Como
// a configuração e os modelos são globais, os 3 viewports se revezam pela trava compartilhada
// de e2e/trava-caixa.ts.
import { expect, test, type Page } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ARQUIVO_ESTADO, USUARIOS, pularSemBackend } from "./suporte";
import { clienteAdmin, prepararFicha, type FixtureFicha } from "./ficha-suporte";
import { TIMEOUT_PREPARACAO_MS, adquirirTravaCaixa } from "./trava-caixa";

test.describe.configure({ mode: "serial" });

const VIEWPORTS = ["computador", "tablet", "celular"];

/**
 * Dia do atendimento (hoje + N). Os outros specs usam, para a mesma profissional: ficha e
 * comissões hoje+5, cobrança hoje e hoje+6, permissões hoje+3, agendar hoje+14…20 (o dia todo)
 * e agenda uma terça entre hoje+2 e hoje+22 (o dia todo). hoje+24 não é de ninguém.
 */
const DIAS_WHATSAPP = 24;

let admin: SupabaseClient;
let liberarTrava: (() => Promise<void>) | null = null;
let fx: FixtureFicha;
let whatsapp = "";
let sufixo = "";
let textoAvulsa = "";
let textoResposta = "";
let variacoesOriginais: string[] | null = null;

async function falhar(p: PromiseLike<{ error: unknown }>) {
  const { error } = await p;
  if (error) throw error;
}

const balao = (page: Page) => page.getByTestId("balao-enviada").filter({ hasText: textoAvulsa });

test.beforeAll(async ({}, testInfo) => {
  test.setTimeout(TIMEOUT_PREPARACAO_MS);
  await pularSemBackend("E2E do WhatsApp");
  admin = clienteAdmin();
  const indice = Math.max(0, VIEWPORTS.indexOf(testInfo.project.name));
  liberarTrava = await adquirirTravaCaixa();

  // Cliente nova com WhatsApp único e um atendimento confirmado em hoje+DIAS_WHATSAPP (dia que
  // nenhum outro spec usa para a profissional de teste), às 8 + viewport.
  fx = await prepararFicha(admin, String(8 + indice), USUARIOS.profissional, DIAS_WHATSAPP);
  sufixo = `${VIEWPORTS[indice]} ${Date.now()}`;
  whatsapp = `55119${String(Date.now()).slice(-7)}${indice}`;
  await falhar(admin.from("clientes").update({ whatsapp }).eq("id", fx.cliente.id));
  textoAvulsa = `Oi! Aviso de teste E2E ${sufixo}`;
  textoResposta = `Resposta de teste E2E ${sufixo}`;

  const { data } = await admin.from("modelos_mensagem").select("variacoes").eq("tipo", "aniversario").maybeSingle();
  variacoesOriginais = (data?.variacoes as string[] | undefined) ?? null;
  await falhar(admin.from("configuracoes_clinica").update({ whatsapp_ativo: false }).neq("id", "00000000-0000-0000-0000-000000000000"));
});

test.afterAll(async () => {
  try {
    if (liberarTrava && admin) {
      // Erros de limpeza não derrubam o spec; o envio sempre termina desligado.
      await admin
        .from("configuracoes_clinica")
        .update({ whatsapp_ativo: false })
        .neq("id", "00000000-0000-0000-0000-000000000000");
      if (variacoesOriginais) {
        await admin.from("modelos_mensagem").update({ variacoes: variacoesOriginais }).eq("tipo", "aniversario");
      }
    }
  } finally {
    await liberarTrava?.();
  }
});

async function ativoNoBanco(): Promise<boolean> {
  const { data, error } = await admin.from("configuracoes_clinica").select("whatsapp_ativo").limit(1).single();
  if (error) throw error;
  return data.whatsapp_ativo as boolean;
}

test.describe("dona", () => {
  test("edita um modelo e vê a prévia com dados de exemplo", async ({ browser }) => {
    const contexto = await browser.newContext({ storageState: ARQUIVO_ESTADO("dona") });
    const page = await contexto.newPage();
    try {
      await page.goto("/configuracoes#whatsapp");
      await expect(page.getByRole("heading", { name: "WhatsApp", exact: true })).toBeVisible();
      const modelo = page.getByRole("article", { name: "Modelo Aniversário" });
      const marcador = `E2E ${sufixo}`;
      await modelo.getByLabel("Variação 1").fill(`Feliz aniversário, {nome}! ${marcador} {clinica}`);
      const previa = modelo.locator("p", { hasText: "Prévia:" }).first();
      await expect(previa).toContainText(marcador);
      await expect(previa).not.toContainText("{nome}");
      await expect(previa).not.toContainText("{clinica}");

      await modelo.getByRole("button", { name: "Salvar modelo Aniversário" }).click();
      await expect(page.getByText('Modelo "Aniversário" salvo.')).toBeVisible();
      await expect
        .poll(async () => {
          const { data } = await admin.from("modelos_mensagem").select("variacoes").eq("tipo", "aniversario").single();
          return JSON.stringify(data?.variacoes ?? []);
        })
        .toContain(marcador);
    } finally {
      await contexto.close();
    }
  });

  test("liga e desliga o envio automático", async ({ browser }) => {
    const contexto = await browser.newContext({ storageState: ARQUIVO_ESTADO("dona") });
    const page = await contexto.newPage();
    try {
      await page.goto("/configuracoes#whatsapp");
      const interruptor = page.getByRole("checkbox", { name: "Envio automático ativo" });
      await expect(interruptor).not.toBeChecked();

      await interruptor.check();
      await page.getByRole("button", { name: "Salvar WhatsApp" }).click();
      await expect(page.getByText("Configurações do WhatsApp salvas.")).toBeVisible();
      await expect.poll(ativoNoBanco).toBe(true);

      // Desliga na mesma hora: o projeto de testes nunca fica com o envio ligado.
      await page.reload();
      await expect(page.getByRole("checkbox", { name: "Envio automático ativo" })).toBeChecked();
      await page.getByRole("checkbox", { name: "Envio automático ativo" }).uncheck();
      await page.getByRole("button", { name: "Salvar WhatsApp" }).click();
      await expect(page.getByText("Configurações do WhatsApp salvas.").last()).toBeVisible();
      await expect.poll(ativoNoBanco).toBe(false);
    } finally {
      await contexto.close();
    }
  });
});

test.describe("recepção", () => {
  test("envia avulsa pela ficha, vê na conversa e cancela", async ({ browser }) => {
    const contexto = await browser.newContext({ storageState: ARQUIVO_ESTADO("recepcao") });
    const page = await contexto.newPage();
    try {
      await page.goto(`/clientes/${fx.cliente.id}`);
      await page.getByRole("button", { name: "Enviar WhatsApp" }).first().click();
      const dialogo = page.getByRole("dialog", { name: "Enviar WhatsApp" });
      await dialogo.getByLabel("Mensagem").fill(textoAvulsa);
      await dialogo.getByRole("button", { name: "Enviar", exact: true }).click();
      await expect(page.getByText("Mensagem enviada para a fila.")).toBeVisible();

      await page.goto(`/mensagens?busca=${encodeURIComponent(fx.cliente.nome)}`);
      await page.getByRole("button", { name: new RegExp(fx.cliente.nome) }).click();
      const item = balao(page);
      await expect(item).toHaveCount(1);
      await expect(item).toContainText("Na fila");

      await item.getByRole("button", { name: "Cancelar", exact: true }).click();
      await item.getByRole("button", { name: "Confirmar cancelamento" }).click();
      await expect(page.getByText("Mensagem cancelada.")).toBeVisible();
      await expect(balao(page).filter({ hasText: "Cancelada" })).toHaveCount(1);
      await expect(balao(page)).toContainText("Cancelada pela equipe");
    } finally {
      await contexto.close();
    }
  });

  test("o detalhe do agendamento tem o botão Enviar WhatsApp", async ({ browser }) => {
    const contexto = await browser.newContext({ storageState: ARQUIVO_ESTADO("recepcao") });
    const page = await contexto.newPage();
    try {
      await page.goto(`/agenda?data=${fx.data}&visao=dia&prof=${fx.profissional.id}`);
      await page.getByRole("button", { name: new RegExp(`^${fx.hora}:00 ${fx.cliente.nome}`) }).click();
      await expect(page.getByRole("button", { name: "Enviar WhatsApp" })).toBeVisible();
    } finally {
      await contexto.close();
    }
  });
});

test.describe("resposta recebida", () => {
  test("aparece em Respostas do WhatsApp no Início e some ao marcar como lida", async ({ browser }) => {
    // Como o webhook: registrar_recebida com a service role (id externo único).
    const { error } = await admin.rpc("registrar_recebida", {
      p_telefone: whatsapp,
      p_texto: textoResposta,
      p_id_externo: `e2e-${sufixo.replace(/\s/g, "-")}`,
    });
    if (error) throw error;

    const contexto = await browser.newContext({ storageState: ARQUIVO_ESTADO("dona") });
    const page = await contexto.newPage();
    try {
      await page.goto("/inicio");
      const cartao = page.getByRole("region", { name: "Respostas do WhatsApp" });
      const item = cartao.getByRole("listitem").filter({ hasText: textoResposta });
      await expect(item).toBeVisible();
      await expect(item).toContainText(fx.cliente.nome);

      await item.getByRole("button", { name: "Marcar como lida" }).click();
      await expect(item).toHaveCount(0);
      await page.reload();
      await expect(page.getByRole("region", { name: "Respostas do WhatsApp" })).toBeVisible();
      await expect(page.getByText(textoResposta)).toHaveCount(0);

      // Continua em Mensagens, agora sem não lidas.
      await page.goto(`/mensagens?busca=${encodeURIComponent(fx.cliente.nome)}`);
      await expect(page.getByRole("listitem").filter({ hasText: textoResposta })).toBeVisible();
      await page.goto("/mensagens?leitura=nao_lidas");
      await expect(page.getByRole("listitem").filter({ hasText: textoResposta })).toHaveCount(0);
    } finally {
      await contexto.close();
    }
  });
});

test.describe("profissional", () => {
  test("não vê o menu Mensagens e /mensagens volta para /inicio", async ({ browser }) => {
    const contexto = await browser.newContext({ storageState: ARQUIVO_ESTADO("profissional") });
    const page = await contexto.newPage();
    try {
      await page.goto("/inicio");
      await expect(page.getByRole("link", { name: "Agenda" }).first()).toBeVisible();
      await expect(page.getByRole("link", { name: "Mensagens" })).toHaveCount(0);
      await page.goto("/mensagens");
      await expect(page).toHaveURL(/\/inicio$/);
    } finally {
      await contexto.close();
    }
  });
});
