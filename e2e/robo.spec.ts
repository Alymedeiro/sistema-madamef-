// Robô de menu ponta a ponta (Fase 5), nos 3 tamanhos. Roda contra o projeto Supabase de TESTES
// com as migrações 0016 e 0017 aplicadas; sem E2E_PERMITIR_PROJETO/backend é pulado (Ruling R3).
// ATENÇÃO: robo_config, robo_opcoes e robo_sessoes não aceitam escrita do service_role (só as
// funções e a dona). Por isso a configuração de teste entra por salvar_robo com a sessão da
// dona e o afterAll devolve a configuração original do mesmo jeito. A mensagem do robô fica na
// fila como Pendente (o relógio do projeto de testes não tem URL: nada sai) e a resposta
// recebida fica no projeto. O spec liga whatsapp_ativo (o robô só atende com ele ligado) e o
// afterAll SEMPRE o desliga; como a configuração é global, os 3 viewports se revezam pela
// trava compartilhada de e2e/trava-caixa.ts.
import { expect, test } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { AMBIENTE, ARQUIVO_ESTADO, USUARIOS, pularSemBackend } from "./suporte";
import { clienteAdmin } from "./ficha-suporte";
import { TIMEOUT_PREPARACAO_MS, adquirirTravaCaixa } from "./trava-caixa";

test.describe.configure({ mode: "serial" });

const VIEWPORTS = ["computador", "tablet", "celular"];
const SEM_ID = "00000000-0000-0000-0000-000000000000";

type OpcaoBanco = { numero: number; rotulo: string; tipo: string; resposta: string | null; ativo: boolean };
type ConfigBanco = {
  ativo: boolean;
  quando: string;
  boas_vindas: string;
  nao_entendi: string;
  rodape_opcao: string;
  link_agendamento: string | null;
};

let admin: SupabaseClient;
let liberarTrava: (() => Promise<void>) | null = null;
let sufixo = "";
let marcador = "";
let nomeCliente = "";
let whatsapp = "";
let clienteId = "";
let original: { config: ConfigBanco; opcoes: OpcaoBanco[] } | null = null;

async function falhar(p: PromiseLike<{ error: unknown }>) {
  const { error } = await p;
  if (error) throw error;
}

/** Cliente Supabase autenticado como a dona (salvar_robo só aceita a dona). */
async function clienteDona(): Promise<SupabaseClient> {
  const c = createClient(AMBIENTE.url!, AMBIENTE.anon!, { auth: { persistSession: false } });
  const { error } = await c.auth.signInWithPassword({
    email: USUARIOS.dona.email,
    password: USUARIOS.dona.senha,
  });
  if (error) throw error;
  return c;
}

async function gravarRobo(c: SupabaseClient, cfg: ConfigBanco, opcoes: OpcaoBanco[]) {
  await falhar(
    c.rpc("salvar_robo", {
      p_ativo: cfg.ativo,
      p_quando: cfg.quando,
      p_boas_vindas: cfg.boas_vindas,
      p_nao_entendi: cfg.nao_entendi,
      p_rodape_opcao: cfg.rodape_opcao,
      p_link_agendamento: cfg.link_agendamento ?? "",
      p_opcoes: opcoes,
    }),
  );
}

async function receber(texto: string, n: number) {
  await falhar(
    admin.rpc("registrar_recebida", {
      p_telefone: whatsapp,
      p_texto: texto,
      p_id_externo: `e2e-robo-${sufixo.replace(/\s/g, "-")}-${n}`,
    }),
  );
}

test.beforeAll(async ({}, testInfo) => {
  test.setTimeout(TIMEOUT_PREPARACAO_MS);
  await pularSemBackend("E2E do robô");
  admin = clienteAdmin();
  const indice = Math.max(0, VIEWPORTS.indexOf(testInfo.project.name));
  liberarTrava = await adquirirTravaCaixa();

  sufixo = `${VIEWPORTS[indice]} ${Date.now()}`;
  marcador = `E2E ${sufixo}`;
  nomeCliente = `Cliente E2E Robô ${sufixo}`;
  whatsapp = `55116${String(Date.now()).slice(-7)}${indice}`;

  const { data: cfg, error: ec } = await admin
    .from("robo_config")
    .select("ativo, quando, boas_vindas, nao_entendi, rodape_opcao, link_agendamento")
    .eq("linha_unica", true)
    .single();
  if (ec) throw ec;
  const { data: ops, error: eo } = await admin
    .from("robo_opcoes")
    .select("numero, rotulo, tipo, resposta, ativo")
    .order("numero");
  if (eo) throw eo;
  original = { config: cfg as ConfigBanco, opcoes: ops as OpcaoBanco[] };

  // Configuração conhecida, com o robô desligado (a dona o liga pela tela, no primeiro teste).
  const dona = await clienteDona();
  await gravarRobo(
    dona,
    {
      ativo: false,
      quando: "sempre",
      boas_vindas: "Oi, {nome}! Menu de teste.",
      nao_entendi: "Não entendi. Digite o número de uma opção.",
      rodape_opcao: "Digite 0 para voltar ao menu.",
      link_agendamento: null,
    },
    [
      { numero: 1, rotulo: "Endereço", tipo: "texto", resposta: "Estamos em {endereco}.", ativo: true },
      { numero: 2, rotulo: "Falar com a equipe", tipo: "falar_com_equipe", resposta: null, ativo: true },
    ],
  );
  await dona.auth.signOut();

  const { data: cliente, error: ecl } = await admin
    .from("clientes")
    .insert({ nome: nomeCliente, whatsapp, aceite_lgpd_em: new Date().toISOString() })
    .select("id")
    .single();
  if (ecl) throw ecl;
  clienteId = cliente.id;
  await falhar(admin.from("configuracoes_clinica").update({ whatsapp_ativo: true }).neq("id", SEM_ID));
});

test.afterAll(async () => {
  try {
    if (liberarTrava && admin) {
      // Erros de limpeza não derrubam o spec; o envio sempre termina desligado.
      await admin.from("configuracoes_clinica").update({ whatsapp_ativo: false }).neq("id", SEM_ID);
      if (original) {
        const dona = await clienteDona();
        await gravarRobo(dona, original.config, original.opcoes);
        await dona.auth.signOut();
      }
      if (clienteId) await admin.from("clientes").update({ ativo: false }).eq("id", clienteId);
    }
  } catch {
    // ignora
  } finally {
    await liberarTrava?.();
  }
});

test.describe("dona", () => {
  test("configura o robô, vê a prévia e salva", async ({ browser }) => {
    const contexto = await browser.newContext({ storageState: ARQUIVO_ESTADO("dona") });
    const page = await contexto.newPage();
    try {
      await page.goto("/configuracoes#whatsapp");
      const secao = page.getByRole("region", { name: "Robô de atendimento" });
      await expect(secao).toBeVisible();

      await secao.getByLabel("Boas-vindas (topo do menu)").fill(`Olá, {nome}! ${marcador}. Escolha uma opção:`);
      const previa = secao.getByLabel("Prévia do menu");
      await expect(previa).toContainText(marcador);
      await expect(previa).not.toContainText("{nome}");
      await expect(previa).toContainText("1 - Endereço");
      await expect(previa).toContainText("2 - Falar com a equipe");
      await expect(secao.getByLabel("Prévia da opção 1")).not.toContainText("{endereco}");

      await secao.getByLabel("Robô ativo").check();
      await secao.getByRole("button", { name: "Salvar robô" }).click();
      await expect(page.getByText("Robô de atendimento salvo.")).toBeVisible();
      await expect
        .poll(async () => {
          const { data } = await admin.from("robo_config").select("ativo, boas_vindas").single();
          return data?.ativo === true && String(data.boas_vindas).includes(marcador);
        })
        .toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    } finally {
      await contexto.close();
    }
  });

  test("uma mensagem recebida gera o menu na conversa, com o selo do robô", async ({ browser }) => {
    await receber("oi", 1);

    const contexto = await browser.newContext({ storageState: ARQUIVO_ESTADO("dona") });
    const page = await contexto.newPage();
    try {
      await page.goto(`/mensagens?busca=${encodeURIComponent(nomeCliente)}`);
      await page.getByRole("button", { name: new RegExp(nomeCliente) }).click();
      const menu = page.getByTestId("balao-enviada").filter({ hasText: marcador });
      await expect(menu).toHaveCount(1);
      await expect(menu).toContainText("Robô");
      await expect(menu).toContainText("1 - Endereço");
      await expect(menu).toContainText("2 - Falar com a equipe");
      await expect(menu).not.toContainText("{nome}");
    } finally {
      await contexto.close();
    }
  });

  test("falar com a equipe pausa o robô e Retomar robô volta a atender", async ({ browser }) => {
    await receber("2", 2);

    const contexto = await browser.newContext({ storageState: ARQUIVO_ESTADO("dona") });
    const page = await contexto.newPage();
    try {
      await page.goto(`/mensagens?busca=${encodeURIComponent(nomeCliente)}`);
      await page.getByRole("button", { name: new RegExp(nomeCliente) }).click();
      await expect(page.getByText(/Robô pausado até/)).toBeVisible();
      await page.getByRole("button", { name: "Retomar robô" }).click();
      await expect(page.getByText(/Robô pausado até/)).toHaveCount(0);
      await expect
        .poll(async () => {
          const { data } = await admin.from("robo_sessoes").select("pausado_ate").eq("telefone", whatsapp).single();
          return data?.pausado_ate ?? null;
        })
        .toBeNull();
    } finally {
      await contexto.close();
    }
  });
});
