// Agendamento online ponta a ponta (/agendar → Início → /agenda/pedidos → agenda), nos 3 tamanhos.
// Roda contra o projeto Supabase de TESTES; sem E2E_PERMITIR_PROJETO/backend é pulado (Ruling R3).
// Também precisa alcançar challenges.cloudflare.com (widget Turnstile com a chave de teste).
// ATENÇÃO: a preparação liga/desliga configuracoes_clinica.online_ativo (que fica desligado no
// fim), cria/atualiza o serviço "E2E Agendamento Online" (60 min, só da profissional de teste),
// refaz a jornada da profissional de teste num dia da semana próprio de cada viewport (quinta,
// sexta, sábado; 14 a 20 dias à frente) e libera o dia dela. Desde a 0012 as mensagens de
// WhatsApp (fila_mensagens) têm FK para agendamentos, pedidos e clientes e ninguém as apaga
// (nem o service_role): nada daqui é apagado. A limpeza cancela os agendamentos do dia (via
// liberarHorario), expira os pedidos aguardando da profissional nesse dia e deixa as clientes;
// telefone e nome são únicos por execução, e as verificações se limitam ao que esta execução
// criou. Como a configuração é global, os 3 viewports se revezam por um lock em arquivo
// (nunca rodam este spec ao mesmo tempo).
import { mkdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { USUARIOS, pularSemBackend } from "./suporte";
import { clienteAdmin, dataEm, entrar, profissionalDeTeste } from "./ficha-suporte";
import { liberarHorario } from "./horario-livre";

test.describe.configure({ mode: "serial" });

const SERVICO = "E2E Agendamento Online";
const LOCK = join(tmpdir(), "e2e-agendar.lock");
const VIEWPORTS = ["computador", "tablet", "celular"];

let admin: SupabaseClient;
let lockAdquirido = false;
let indice = 0;
let dia = "";
let profissional: { id: string; nome: string };
let servicoId = "";
let nomeCliente = "";
let whatsappDigitado = "";
let whatsappBanco = "";
let telefoneOriginal: string | null = null;
let configId = "";

async function falhar(p: PromiseLike<{ error: unknown }>) {
  const { error } = await p;
  if (error) throw error;
}

async function adquirirLock() {
  const limite = Date.now() + 8 * 60_000;
  while (Date.now() < limite) {
    try {
      await mkdir(LOCK);
      lockAdquirido = true;
      return;
    } catch {
      // Lock velho (execução interrompida): descarta.
      const s = await stat(LOCK).catch(() => null);
      if (s && Date.now() - s.mtimeMs > 20 * 60_000) await rm(LOCK, { recursive: true, force: true });
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  throw new Error("Não foi possível obter o lock do E2E de agendamento online.");
}

/** Primeiro dia a partir de hoje+14 cujo dia da semana é `diaSemana` (YYYY-MM-DD, São Paulo). */
function diaComSemana(diaSemana: number): string {
  for (let n = 14; n < 21; n++) {
    const d = dataEm(n);
    if (new Date(`${d}T12:00:00-03:00`).getUTCDay() === diaSemana) return d;
  }
  throw new Error("dia da semana não encontrado");
}

/** Libera o dia da profissional sem apagar nada (a fila de WhatsApp referencia essas linhas). */
async function limparTeste() {
  await falhar(
    admin
      .from("pedidos_online")
      .update({ status: "expirado" })
      .eq("profissional_id", profissional.id)
      .eq("status", "aguardando")
      .gte("inicio", `${dia}T00:00:00-03:00`)
      .lt("inicio", `${dia}T23:59:59-03:00`),
  );
  await liberarHorario(admin, profissional.id, `${dia}T00:00:00-03:00`, `${dia}T23:59:59-03:00`);
}

test.beforeAll(async ({}, testInfo) => {
  test.setTimeout(10 * 60_000);
  await pularSemBackend("E2E do agendamento online");
  admin = clienteAdmin();
  indice = Math.max(0, VIEWPORTS.indexOf(testInfo.project.name));
  await adquirirLock();

  dia = diaComSemana(4 + indice);
  // Únicos por execução: pedidos e clientes de execuções anteriores continuam no banco.
  const unico = String(Date.now() % 10_000_000).padStart(7, "0");
  nomeCliente = `Cliente Online E2E ${VIEWPORTS[indice]} ${unico}`;
  whatsappDigitado = `(11) 98${indice}${unico.slice(0, 2)}-${unico.slice(2, 6)}`;
  whatsappBanco = `55119 8${indice}${unico.slice(0, 2)}${unico.slice(2, 6)}`.replace(/\s/g, "");
  profissional = await profissionalDeTeste(admin);

  const { data: cfg, error: ec } = await admin.from("configuracoes_clinica").select("id, telefone").limit(1).single();
  if (ec) throw ec;
  configId = cfg.id;
  telefoneOriginal = cfg.telefone;
  await falhar(
    admin
      .from("configuracoes_clinica")
      .update({ online_ativo: true, telefone: cfg.telefone ?? "(11) 3333-0000" })
      .eq("id", configId),
  );

  // Serviço próprio, só da profissional de teste: a lista não depende de outras profissionais.
  let { data: servico } = await admin.from("servicos").select("id").eq("nome", SERVICO).maybeSingle();
  if (!servico) {
    const { data: base, error: eb } = await admin.from("servicos").select("categoria_id").limit(1).single();
    if (eb) throw eb;
    const r = await admin
      .from("servicos")
      .insert({ nome: SERVICO, categoria_id: base.categoria_id, duracao_min: 60, permite_online: true })
      .select("id")
      .single();
    if (r.error) throw r.error;
    servico = r.data;
  }
  servicoId = servico!.id;
  await falhar(
    admin
      .from("servicos")
      .update({ ativo: true, permite_online: true, exige_avaliacao: false, duracao_min: 60 })
      .eq("id", servicoId),
  );
  await falhar(admin.from("colaborador_servicos").delete().eq("servico_id", servicoId));
  await falhar(admin.from("colaborador_servicos").insert({ colaborador_id: profissional.id, servico_id: servicoId }));

  // Jornada 09–13 no dia da semana deste viewport.
  await falhar(admin.from("jornadas").delete().eq("colaborador_id", profissional.id).eq("dia_semana", 4 + indice));
  await falhar(
    admin
      .from("jornadas")
      .insert({ colaborador_id: profissional.id, dia_semana: 4 + indice, hora_inicio: "09:00", hora_fim: "13:00" }),
  );
  await limparTeste();
});

test.afterAll(async () => {
  try {
    if (lockAdquirido && admin) {
      await limparTeste().catch(() => undefined);
      await admin
        .from("configuracoes_clinica")
        .update({ online_ativo: false, telefone: telefoneOriginal })
        .eq("id", configId);
    }
  } finally {
    if (lockAdquirido) await rm(LOCK, { recursive: true, force: true });
  }
});

function botaoDia(page: Page) {
  const [, m, d] = dia.split("-");
  return page.getByRole("group", { name: "Dia" }).getByRole("button").filter({ hasText: `${d}/${m}` });
}

/** Abre /agendar até a lista de horários do dia de teste carregada (há ao menos um livre). */
async function abrirHorarios(page: Page) {
  await page.goto("/agendar");
  await page.getByRole("button", { name: new RegExp(SERVICO) }).click();
  await page.getByRole("button", { name: "Qualquer uma" }).click();
  await botaoDia(page).click();
  await expect(page.getByRole("group", { name: "Horário" })).toBeVisible();
  return (hora: string) =>
    page.getByRole("group", { name: "Horário" }).getByRole("button", { name: hora, exact: true });
}

async function pedir(page: Page, hora: string) {
  await (await abrirHorarios(page))(hora).click();
  await page.getByLabel("Nome", { exact: true }).fill(nomeCliente);
  await page.getByLabel("WhatsApp com DDD").fill(whatsappDigitado);
  await page.getByLabel("Li e aceito o aviso de privacidade").check();
  const enviar = page.getByRole("button", { name: "Pedir horário" });
  await expect(enviar).toBeEnabled({ timeout: 30_000 });
  await enviar.click();
  await expect(page.getByText("Pedido recebido!")).toBeVisible();
}

test("cliente faz pedido em /agendar e vê 'Pedido recebido!'", async ({ page }) => {
  await pedir(page, "09:00");
  const { data } = await admin
    .from("pedidos_online")
    .select("status, profissional_id")
    .eq("whatsapp", whatsappBanco);
  expect(data).toEqual([{ status: "aguardando", profissional_id: profissional.id }]);
});

test("recepção vê o card no Início, aprova com cliente nova e o agendamento fica confirmado na agenda", async ({
  page,
}) => {
  await pedir(page, "10:00");
  await entrar(page, USUARIOS.recepcao.email, USUARIOS.recepcao.senha);
  await expect(page.getByText(/Pedidos online aguardando/)).toBeVisible();
  const [, mes, d] = dia.split("-");
  await expect(
    page
      .getByRole("listitem")
      .filter({ hasText: `${nomeCliente} · ${SERVICO}` })
      .filter({ hasText: `${d}/${mes} 10:00` }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Ver pedidos online" }).click();
  await page.waitForURL("**/agenda/pedidos**");

  const card = page.getByRole("listitem").filter({ hasText: nomeCliente }).filter({ hasText: "10:00" });
  await card.getByRole("button", { name: "Aprovar" }).click();
  const dialogo = page.getByRole("dialog", { name: "Aprovar pedido" });
  await dialogo.getByLabel("Cadastrar nova cliente").check();
  await dialogo.getByRole("button", { name: "Confirmar agendamento" }).click();

  await expect(page.getByRole("dialog", { name: "Pedido aprovado" })).toBeVisible();
  const whats = page.getByRole("link", { name: "Avisar no WhatsApp" });
  await expect(whats).toHaveAttribute("href", /^https:\/\/wa\.me\//);

  const { data: ag } = await admin
    .from("agendamentos")
    .select("status")
    .eq("profissional_id", profissional.id)
    .eq("inicio", `${dia}T10:00:00-03:00`)
    .neq("status", "cancelado")
    .single();
  expect(ag?.status).toBe("confirmado");

  await page.goto(`/agenda?data=${dia}&visao=dia&prof=${profissional.id}`);
  await expect(page.getByRole("button", { name: new RegExp(`^10:00 ${nomeCliente}`) })).toBeVisible();
});

test("recusar libera o horário: o mesmo horário volta a aparecer em /agendar", async ({ page }) => {
  await pedir(page, "11:00");

  // Reservado enquanto aguarda: 11:00 some, mas 12:00 segue livre (a lista carregou).
  const antes = await abrirHorarios(page);
  await expect(antes("12:00")).toBeVisible();
  await expect(antes("11:00")).toHaveCount(0);

  await entrar(page, USUARIOS.recepcao.email, USUARIOS.recepcao.senha);
  await page.goto("/agenda/pedidos?status=aguardando");
  const card = page.getByRole("listitem").filter({ hasText: nomeCliente }).filter({ hasText: "11:00" });
  await card.getByRole("button", { name: "Recusar" }).click();
  await page.getByRole("dialog", { name: "Recusar pedido" }).getByRole("button", { name: "Recusar pedido" }).click();
  await expect(page.getByRole("dialog", { name: "Pedido recusado" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Avisar no WhatsApp" })).toHaveAttribute("href", /^https:\/\/wa\.me\//);

  const depois = await abrirHorarios(page);
  await expect(depois("12:00")).toBeVisible();
  await expect(depois("11:00")).toBeVisible();
});

test("/agendar com online desligado mostra 'Agendamento online indisponível' e o telefone", async ({ page }) => {
  await falhar(admin.from("configuracoes_clinica").update({ online_ativo: false }).eq("id", configId));
  try {
    const { data } = await admin.from("configuracoes_clinica").select("telefone").eq("id", configId).single();
    await page.goto("/agendar");
    const aviso = page.getByRole("status").filter({ hasText: "Agendamento online indisponível" });
    await expect(aviso).toBeVisible();
    await expect(aviso).toContainText(data!.telefone!);
  } finally {
    await falhar(admin.from("configuracoes_clinica").update({ online_ativo: true }).eq("id", configId));
  }
});
