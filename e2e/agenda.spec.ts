// Agenda ponta a ponta (Task 11; executado na Task 14 contra um projeto
// Supabase de teste). Sem backend configurado/alcançável, o arquivo inteiro
// é pulado com mensagem explícita (Ruling R3).
//
// Variáveis: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
// SUPABASE_SERVICE_ROLE_KEY, E2E_RECEPCAO_EMAIL, E2E_RECEPCAO_SENHA,
// E2E_PROFISSIONAL_EMAIL, E2E_PROFISSIONAL_SENHA.
//
// Preparação (service role, só no projeto de teste): a profissional recebe
// jornada 09–12 e 13–18 no dia escolhido (almoço 12–13), passa a realizar um
// serviço ativo de 60 min, e os agendamentos dela nesse dia são cancelados (liberarHorario; nada é apagado).

import { expect, test, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { AMBIENTE, USUARIOS, pularSemBackend } from "./suporte";
import { liberarHorario } from "./horario-livre";

const ENV = {
  ...AMBIENTE,
  recepcaoEmail: USUARIOS.recepcao.email,
  recepcaoSenha: USUARIOS.recepcao.senha,
  profissionalEmail: USUARIOS.profissional.email,
  profissionalSenha: USUARIOS.profissional.senha,
};

test.describe.configure({ mode: "serial" });

type Fixtures = {
  data: string;
  profissional: { id: string; nome: string };
  cliente: { id: string; nome: string };
  servicoNome: string;
};

let admin: SupabaseClient;
let fx: Fixtures;

/** Próxima terça (≥ 2 dias à frente), uma semana a mais por projeto para não colidirem. */
function dataDoTeste(indiceProjeto: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 2);
  while (d.getUTCDay() !== 2) d.setUTCDate(d.getUTCDate() + 1);
  d.setUTCDate(d.getUTCDate() + 7 * indiceProjeto);
  return d.toISOString().slice(0, 10);
}

async function colaboradorPorEmail(email: string) {
  const { data, error } = await admin.auth.admin.listUsers({ perPage: 1000 });
  if (error) throw error;
  const usuario = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
  if (!usuario) throw new Error(`Usuário ${email} não existe no projeto de teste.`);
  const { data: c, error: e2 } = await admin
    .from("colaboradores")
    .select("id, nome")
    .eq("usuario_auth_id", usuario.id)
    .single();
  if (e2) throw e2;
  return c as { id: string; nome: string };
}

async function preparar(indiceProjeto: number): Promise<Fixtures> {
  const data = dataDoTeste(indiceProjeto);
  const profissional = await colaboradorPorEmail(ENV.profissionalEmail!);

  const { data: servico, error: es } = await admin
    .from("servicos")
    .select("id, nome")
    .eq("ativo", true)
    .eq("duracao_min", 60)
    .limit(1)
    .single();
  if (es) throw es;
  await admin
    .from("colaborador_servicos")
    .upsert(
      { colaborador_id: profissional.id, servico_id: servico.id },
      { onConflict: "colaborador_id,servico_id" },
    );

  await admin.from("jornadas").delete().eq("colaborador_id", profissional.id).eq("dia_semana", 2);
  await admin.from("jornadas").insert([
    { colaborador_id: profissional.id, dia_semana: 2, hora_inicio: "09:00", hora_fim: "12:00" },
    { colaborador_id: profissional.id, dia_semana: 2, hora_inicio: "13:00", hora_fim: "18:00" },
  ]);
  // Nada é apagado (comissões e fila de WhatsApp referenciam o agendamento): libera o dia.
  await liberarHorario(admin, profissional.id, `${data}T00:00:00-03:00`, `${data}T23:59:59-03:00`);

  const nome = `Cliente E2E Agenda ${Date.now()}`;
  const { data: cliente, error: ec } = await admin
    .from("clientes")
    .insert({ nome, aceite_lgpd_em: new Date().toISOString() })
    .select("id, nome")
    .single();
  if (ec) throw ec;

  return { data, profissional, cliente, servicoNome: servico.nome };
}

async function entrar(page: Page, email: string, senha: string) {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(senha);
  await page.getByRole("button", { name: "Entrar" }).click();
  await page.waitForURL("**/inicio");
}

async function abrirAgenda(page: Page) {
  await page.goto(`/agenda?data=${fx.data}&visao=dia&prof=${fx.profissional.id}`);
}

async function preencherAgendamento(page: Page, hora?: string) {
  const dialogo = page.getByRole("dialog");
  await dialogo.getByLabel("Cliente").fill(fx.cliente.nome);
  await dialogo.getByRole("button", { name: new RegExp(fx.cliente.nome) }).click();
  if (hora) await dialogo.getByLabel("Horário").fill(hora);
  const servico = dialogo.getByLabel("Serviço");
  const valor = await servico.locator("option", { hasText: `${fx.servicoNome} ·` }).first().getAttribute("value");
  await servico.selectOption(valor!);
  await dialogo.getByRole("button", { name: "Salvar" }).click();
}

test.beforeAll(async ({}, testInfo) => {
  await pularSemBackend("E2E da agenda");
  admin = createClient(ENV.url!, ENV.service!, { auth: { persistSession: false } });
  const indice = ["computador", "tablet", "celular"].indexOf(testInfo.project.name);
  fx = await preparar(Math.max(0, indice));
});

test("recepção cria agendamento tocando um horário livre e o cartão aparece pendente", async ({ page }) => {
  await entrar(page, ENV.recepcaoEmail!, ENV.recepcaoSenha!);
  await abrirAgenda(page);
  await page.getByRole("button", { name: `Agendar ${fx.profissional.nome} às 10:00` }).click();
  await preencherAgendamento(page);

  const cartao = page.getByRole("button", { name: new RegExp(`^10:00 ${fx.cliente.nome}`) });
  await expect(cartao).toBeVisible();
  await expect(cartao).toHaveAttribute("data-status", "pendente");
  await expect(cartao).toContainText("Pendente");
});

test("mesmo horário da mesma profissional é recusado", async ({ page }) => {
  await entrar(page, ENV.recepcaoEmail!, ENV.recepcaoSenha!);
  await abrirAgenda(page);
  // O cartão das 10:00 cobre o horário; abre-se outro livre e troca-se a hora.
  await page.getByRole("button", { name: `Agendar ${fx.profissional.nome} às 11:00` }).click();
  await preencherAgendamento(page, "10:30");
  await expect(page.getByRole("dialog").getByRole("alert")).toHaveText(
    "Este horário já está ocupado para esta profissional.",
  );
});

test("agendar às 12:30 (almoço) pede confirmação de encaixe", async ({ page }) => {
  await entrar(page, ENV.recepcaoEmail!, ENV.recepcaoSenha!);
  await abrirAgenda(page);
  await page.getByRole("button", { name: `Agendar ${fx.profissional.nome} às 12:30` }).click();
  await preencherAgendamento(page);
  await expect(page.getByRole("heading", { name: "Encaixar mesmo assim?" })).toBeVisible();
  await page.getByRole("button", { name: "Sim, encaixar" }).click();
  await expect(page.getByRole("button", { name: new RegExp(`^12:30 ${fx.cliente.nome}`) })).toBeVisible();
});

test("profissional logada não vê a coluna de outra profissional", async ({ page }) => {
  await entrar(page, ENV.profissionalEmail!, ENV.profissionalSenha!);
  await page.goto(`/agenda?data=${fx.data}&visao=dia`);
  const colunas = page.getByRole("region", { name: /^Agenda de / });
  await expect(colunas).toHaveCount(1);
  await expect(colunas.first()).toHaveAccessibleName(`Agenda de ${fx.profissional.nome}`);
  // Ela não agenda: não há horários livres clicáveis.
  await expect(page.getByRole("button", { name: /^Agendar / })).toHaveCount(0);
});
