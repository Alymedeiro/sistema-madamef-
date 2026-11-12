// CRM ponta a ponta (Fase 5), nos 3 tamanhos. Roda contra o projeto Supabase de TESTES com as
// migrações 0014 e 0015 aplicadas; sem E2E_PERMITIR_PROJETO/backend é pulado (Ruling R3).
// ATENÇÃO: leads e mensagens da fila não podem ser apagados (sem "delete" para o service_role):
// o lead fica no projeto de testes (nome e telefone únicos por execução) e a reativação fica na
// fila como Pendente, que nunca sai porque o relógio do projeto de testes não tem URL. A
// limpeza é tolerante: desativa as clientes criadas e libera o horário do atendimento antigo
// (cancela ou arquiva, ver e2e/horario-livre.ts), o que tira a cliente da lista de sumidas.
import { expect, test, type Page } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ARQUIVO_ESTADO, USUARIOS, pularSemBackend } from "./suporte";
import { clienteAdmin, dataEm, profissionalDeTeste } from "./ficha-suporte";
import { liberarHorario } from "./horario-livre";

test.describe.configure({ mode: "serial" });

const VIEWPORTS = ["computador", "tablet", "celular"];
/** Dias atrás do último atendimento da cliente sumida (o padrão de "sumida" é 90 dias). */
const DIAS_SUMIDA = 400;

let admin: SupabaseClient;
let sufixo = "";
let nomeLead = "";
let whatsappLead = "";
let nomeSumida = "";
let whatsappSumida = "";
let sumidaId = "";
let leadClienteId: string | null = null;
let slot: { profissionalId: string; inicio: string; fim: string } | null = null;

async function falhar(p: PromiseLike<{ error: unknown }>) {
  const { error } = await p;
  if (error) throw error;
}

test.beforeAll(async ({}, testInfo) => {
  test.setTimeout(120_000);
  await pularSemBackend("E2E do CRM");
  admin = clienteAdmin();
  const indice = Math.max(0, VIEWPORTS.indexOf(testInfo.project.name));
  sufixo = `${VIEWPORTS[indice]} ${Date.now()}`;
  const fim = `${String(Date.now()).slice(-7)}${indice}`;
  nomeLead = `Lead E2E CRM ${sufixo}`;
  whatsappLead = `55118${fim}`;
  nomeSumida = `Sumida E2E CRM ${sufixo}`;
  whatsappSumida = `55117${fim}`;

  // Cliente sumida: aceita marketing e tem um atendimento 'atendido' há DIAS_SUMIDA dias
  // (um minuto por viewport, para os projetos paralelos não se atropelarem).
  const profissional = await profissionalDeTeste(admin, USUARIOS.profissional);
  const { data: base, error: eb } = await admin
    .from("servicos")
    .select("categoria_id")
    .eq("ativo", true)
    .limit(1)
    .single();
  if (eb) throw eb;
  const { data: servico, error: es } = await admin
    .from("servicos")
    .insert({
      nome: `Serviço E2E CRM ${sufixo}`,
      categoria_id: base.categoria_id,
      duracao_min: 30,
      preco_centavos: 5000,
    })
    .select("id, preco_centavos")
    .single();
  if (es) throw es;
  await admin.from("colaborador_servicos").insert({ colaborador_id: profissional.id, servico_id: servico.id });
  const { data: cliente, error: ec } = await admin
    .from("clientes")
    .insert({
      nome: nomeSumida,
      whatsapp: whatsappSumida,
      aceita_whatsapp_marketing: true,
      aceite_lgpd_em: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (ec) throw ec;
  sumidaId = cliente.id;

  const dia = dataEm(-DIAS_SUMIDA);
  const hora = String(6 + indice).padStart(2, "0");
  slot = {
    profissionalId: profissional.id,
    inicio: `${dia}T${hora}:00:00-03:00`,
    fim: `${dia}T${hora}:30:00-03:00`,
  };
  await liberarHorario(admin, slot.profissionalId, slot.inicio, slot.fim);
  await falhar(
    admin.from("agendamentos").insert({
      cliente_id: cliente.id,
      profissional_id: profissional.id,
      servico_id: servico.id,
      inicio: slot.inicio,
      fim: slot.fim,
      status: "atendido",
      valor_previsto_centavos: servico.preco_centavos,
    }),
  );
});

test.afterAll(async () => {
  // Limpeza tolerante: nada aqui derruba o spec.
  try {
    if (!admin) return;
    if (slot) await liberarHorario(admin, slot.profissionalId, slot.inicio, slot.fim).catch(() => undefined);
    const ids = [sumidaId, leadClienteId].filter((x): x is string => !!x);
    if (ids.length) await admin.from("clientes").update({ ativo: false }).in("id", ids);
  } catch {
    // ignora
  }
});

/** Cartão do lead visível (a lista do celular/tablet e as colunas do computador coexistem no DOM). */
const cartao = (page: Page) =>
  page.locator('[data-testid="cartao-lead"]:visible', { hasText: nomeLead });

/** No celular e no tablet o quadro é filtrado por etapa; no computador há uma coluna por etapa. */
async function verEtapa(page: Page, rotulo: string) {
  const filtro = page.getByRole("group", { name: "Filtrar por etapa" });
  if (await filtro.isVisible()) {
    await filtro.getByRole("button", { name: new RegExp(`^${rotulo} \\(`) }).click();
  }
}

test.describe("dona", () => {
  test("abre as 4 abas do CRM", async ({ browser }) => {
    const contexto = await browser.newContext({ storageState: ARQUIVO_ESTADO("dona") });
    const page = await contexto.newPage();
    try {
      await page.goto("/crm");
      await expect(page.getByRole("heading", { name: "CRM", exact: true })).toBeVisible();
      const abas = page.getByRole("navigation", { name: "Seções do CRM" });
      await expect(abas.getByRole("link", { name: "Retorno" })).toHaveAttribute("aria-current", "page");
      for (const rotulo of ["Sumidas", "Leads", "Aniversariantes", "Retorno"]) {
        await abas.getByRole("link", { name: rotulo }).click();
        await expect(abas.getByRole("link", { name: rotulo })).toHaveAttribute("aria-current", "page");
        await expect(page.getByRole("alert")).toHaveCount(0);
      }
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
    } finally {
      await contexto.close();
    }
  });
});

test.describe("recepção", () => {
  test("cria um lead, move para Em conversa e converte em cliente", async ({ browser }) => {
    const contexto = await browser.newContext({ storageState: ARQUIVO_ESTADO("recepcao") });
    const page = await contexto.newPage();
    try {
      await page.goto("/crm?aba=leads");
      await page.getByRole("button", { name: "Novo lead" }).click();
      const dialogo = page.getByRole("dialog", { name: "Novo lead" });
      await dialogo.getByLabel("Nome").fill(nomeLead);
      await dialogo.getByLabel("WhatsApp").fill(whatsappLead.slice(2));
      await dialogo.getByRole("button", { name: "Salvar" }).click();
      await expect(page.getByText("Lead criado.")).toBeVisible();
      await expect(cartao(page)).toHaveCount(1);

      await cartao(page).getByLabel(`Mover ${nomeLead} para…`).selectOption({ label: "Em conversa" });
      await expect(page.getByText("Movido para Em conversa.")).toBeVisible();
      await verEtapa(page, "Em conversa");
      await expect(cartao(page)).toHaveCount(1);
      await expect
        .poll(async () => {
          const { data } = await admin.from("leads").select("etapa").eq("nome", nomeLead).single();
          return data?.etapa;
        })
        .toBe("em_conversa");

      await cartao(page).getByRole("button", { name: "Converter em cliente" }).click();
      const conversao = page.getByRole("dialog", { name: "Converter em cliente" });
      await expect(conversao.getByRole("button", { name: "Converter", exact: true })).toBeDisabled();
      await conversao.getByRole("checkbox").first().check();
      await conversao.getByRole("button", { name: "Converter", exact: true }).click();
      await expect(page.getByText("Lead convertido em cliente.")).toBeVisible();
      await expect(cartao(page).getByRole("link", { name: "Abrir ficha" })).toBeVisible();
      await expect(cartao(page).getByRole("button", { name: "Converter em cliente" })).toHaveCount(0);

      const { data } = await admin.from("leads").select("cliente_id").eq("nome", nomeLead).single();
      leadClienteId = (data?.cliente_id as string | null) ?? null;
      expect(leadClienteId).not.toBeNull();
    } finally {
      await contexto.close();
    }
  });

  test("seleciona a cliente sumida, envia a reativação e vê a mensagem Pendente na conversa", async ({ browser }) => {
    const contexto = await browser.newContext({ storageState: ARQUIVO_ESTADO("recepcao") });
    const page = await contexto.newPage();
    try {
      await page.goto("/crm?aba=sumidas");
      const escolha = page.getByRole("checkbox", { name: `Escolher ${nomeSumida}` });
      await expect(escolha).toBeVisible();
      await escolha.check();
      await page.getByRole("button", { name: "Enviar reativação (1)" }).first().click();

      const dialogo = page.getByRole("dialog", { name: "Enviar reativação" });
      await expect(dialogo).toContainText("1 cliente selecionada");
      await dialogo.getByRole("button", { name: "Enviar reativação (1)" }).click();
      await expect(page.getByTestId("resultado-reativacao")).toHaveText("1 na fila, 0 puladas");
      await page.getByRole("dialog").getByRole("button", { name: "Fechar" }).first().click();

      await expect
        .poll(async () => {
          const { data } = await admin
            .from("fila_mensagens")
            .select("status")
            .eq("cliente_id", sumidaId)
            .eq("tipo", "reativacao");
          return (data ?? []).map((m) => m.status as string);
        })
        .toEqual(["pendente"]);

      await page.goto(`/mensagens?busca=${encodeURIComponent(nomeSumida)}`);
      await page.getByRole("button", { name: new RegExp(nomeSumida) }).click();
      const balao = page.getByTestId("balao-enviada").filter({ hasText: "Reativação" });
      await expect(balao).toHaveCount(1);
      await expect(balao).toContainText("Na fila");
    } finally {
      await contexto.close();
    }
  });
});

test.describe("profissional", () => {
  test("não vê o menu CRM e /crm volta para /inicio", async ({ browser }) => {
    const contexto = await browser.newContext({ storageState: ARQUIVO_ESTADO("profissional") });
    const page = await contexto.newPage();
    try {
      await page.goto("/inicio");
      await expect(page.getByRole("link", { name: "Agenda" }).first()).toBeVisible();
      await expect(page.getByRole("link", { name: "CRM", exact: true })).toHaveCount(0);
      await page.goto("/crm");
      await expect(page).toHaveURL(/\/inicio$/);
    } finally {
      await contexto.close();
    }
  });
});

test.describe("indicadores", () => {
  test("a dona vê os 4 cartões do CRM no Início", async ({ browser }) => {
    const contexto = await browser.newContext({ storageState: ARQUIVO_ESTADO("dona") });
    const page = await contexto.newPage();
    try {
      await page.goto("/inicio");
      const quadro = page.getByRole("region", { name: "CRM" });
      await expect(quadro).toBeVisible();
      for (const rotulo of [
        "Retornos da semana",
        "Clientes sumidas",
        "Leads em aberto",
        "Leads convertidos no mês",
      ]) {
        await expect(quadro.getByRole("link", { name: new RegExp(rotulo) })).toBeVisible();
      }
      // A cliente sumida deste teste já recebeu a reativação, mas continua contando como sumida.
      await expect(quadro.getByRole("link", { name: /Leads convertidos no mês/ })).toContainText(/[1-9]/);
    } finally {
      await contexto.close();
    }
  });
});
