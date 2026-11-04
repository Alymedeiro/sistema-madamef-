// Pagamento do atendimento e caixa do dia ponta a ponta (Task 12; executado na
// Task 14 contra um projeto Supabase de teste). Sem backend configurado/alcançável,
// o arquivo inteiro é pulado com mensagem explícita (Ruling R3).
//
// Variáveis: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
// SUPABASE_SERVICE_ROLE_KEY, E2E_RECEPCAO_EMAIL, E2E_RECEPCAO_SENHA,
// E2E_PROFISSIONAL_EMAIL.
//
// ATENÇÃO (só projeto de teste): a preparação APAGA pagamentos, contas a receber
// e o caixa de hoje (fuso de São Paulo), pois só existe um caixa por dia. Por isso
// roda apenas no projeto desktop do Playwright (os três viewports compartilhariam
// o mesmo caixa). Cria uma cliente e um atendimento confirmado hoje às 14:00.

import { expect, test, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const ENV = {
  url: process.env.NEXT_PUBLIC_SUPABASE_URL,
  anon: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  service: process.env.SUPABASE_SERVICE_ROLE_KEY,
  recepcaoEmail: process.env.E2E_RECEPCAO_EMAIL,
  recepcaoSenha: process.env.E2E_RECEPCAO_SENHA,
  profissionalEmail: process.env.E2E_PROFISSIONAL_EMAIL,
};
const faltando = Object.entries(ENV)
  .filter(([, v]) => !v)
  .map(([k]) => k);

test.describe.configure({ mode: "serial" });

type Fixtures = {
  hoje: string;
  profissional: { id: string; nome: string };
  cliente: { id: string; nome: string };
  servicoNome: string;
};

let admin: SupabaseClient;
let fx: Fixtures;

async function backendAlcancavel(): Promise<boolean> {
  try {
    const r = await fetch(`${ENV.url}/auth/v1/health`, {
      headers: { apikey: ENV.anon! },
      signal: AbortSignal.timeout(5000),
    });
    return r.ok;
  } catch {
    return false;
  }
}

async function preparar(): Promise<Fixtures> {
  const hoje = new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Sao_Paulo" }).format(new Date());

  const { data: usuarios, error: eu } = await admin.auth.admin.listUsers({ perPage: 1000 });
  if (eu) throw eu;
  const usuario = usuarios.users.find(
    (u) => u.email?.toLowerCase() === ENV.profissionalEmail!.toLowerCase(),
  );
  if (!usuario) throw new Error(`Usuário ${ENV.profissionalEmail} não existe no projeto de teste.`);
  const { data: profissional, error: ep } = await admin
    .from("colaboradores")
    .select("id, nome")
    .eq("usuario_auth_id", usuario.id)
    .single();
  if (ep) throw ep;

  const { data: servico, error: es } = await admin
    .from("servicos")
    .select("id, nome, preco_centavos")
    .eq("ativo", true)
    .limit(1)
    .single();
  if (es) throw es;

  // Zera o caixa de hoje (um por dia): filhos primeiro.
  const { data: caixa } = await admin.from("caixas").select("id").eq("data", hoje).maybeSingle();
  if (caixa) {
    const { data: pags } = await admin.from("pagamentos").select("id").eq("caixa_id", caixa.id);
    const ids = (pags ?? []).map((p) => p.id);
    if (ids.length) await admin.from("contas_receber").delete().in("pagamento_id", ids);
    await admin.from("pagamentos").delete().eq("caixa_id", caixa.id);
    await admin.from("caixas").delete().eq("id", caixa.id);
  }

  const nome = `Cliente E2E Caixa ${Date.now()}`;
  const { data: cliente, error: ec } = await admin
    .from("clientes")
    .insert({ nome, aceite_lgpd_em: new Date().toISOString() })
    .select("id, nome")
    .single();
  if (ec) throw ec;

  await admin
    .from("agendamentos")
    .delete()
    .eq("profissional_id", profissional.id)
    .gte("inicio", `${hoje}T14:00:00-03:00`)
    .lt("inicio", `${hoje}T15:00:00-03:00`);
  const { error: ea } = await admin.from("agendamentos").insert({
    cliente_id: cliente.id,
    profissional_id: profissional.id,
    servico_id: servico.id,
    inicio: `${hoje}T14:00:00-03:00`,
    fim: `${hoje}T15:00:00-03:00`,
    status: "confirmado",
    valor_previsto_centavos: servico.preco_centavos,
  });
  if (ea) throw ea;

  return { hoje, profissional, cliente, servicoNome: servico.nome };
}

async function entrar(page: Page, email: string, senha: string) {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(senha);
  await page.getByRole("button", { name: "Entrar" }).click();
  await page.waitForURL("**/inicio");
}

test.beforeAll(async ({}, testInfo) => {
  test.skip(
    testInfo.project.name !== "computador",
    "E2E do caixa roda só no viewport desktop: há um único caixa por dia.",
  );
  test.skip(
    faltando.length > 0,
    `E2E do caixa pulado: defina ${faltando.join(", ")} (projeto Supabase de teste — Ruling R3).`,
  );
  test.skip(
    !(await backendAlcancavel()),
    `E2E do caixa pulado: ${ENV.url} não responde (sem backend Supabase alcançável — Ruling R3).`,
  );
  admin = createClient(ENV.url!, ENV.service!, { auth: { persistSession: false } });
  fx = await preparar();
});

test("recepção marca Atendido, abre o caixa, lança Pix e fecha com diferença R$ 0,00", async ({ page }) => {
  await entrar(page, ENV.recepcaoEmail!, ENV.recepcaoSenha!);
  await page.goto(`/agenda?data=${fx.hoje}&visao=dia&prof=${fx.profissional.id}`);

  await page.getByRole("button", { name: new RegExp(`^14:00 ${fx.cliente.nome}`) }).click();
  await page.getByRole("button", { name: "Marcar como atendido" }).click();

  // O diálogo de pagamento abre; sem caixa, oferece abrir agora (troco 0,00).
  const dialogo = page.getByRole("dialog", { name: "Pagamento do atendimento" });
  await expect(dialogo).toBeVisible();
  await dialogo.getByRole("button", { name: "Abrir caixa agora" }).click();

  await dialogo.getByLabel("Forma de pagamento").selectOption("pix");
  await dialogo.getByRole("button", { name: "Registrar pagamento" }).click();
  await expect(dialogo).toBeHidden();

  await page.goto("/caixa");
  await expect(page.getByRole("cell", { name: fx.cliente.nome })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Pix" })).toBeVisible();

  // Só Pix: dinheiro esperado = troco inicial (0,00).
  await page.getByLabel("Dinheiro contado na gaveta").fill("0,00");
  await page.getByRole("button", { name: "Fechar caixa" }).click();
  await page.getByRole("button", { name: "Sim, fechar caixa" }).click();
  await expect(page.getByTestId("diferenca-caixa")).toContainText("R$ 0,00");

  // Recepção não vê mais os lançamentos do caixa fechado.
  await page.goto("/caixa");
  await expect(page.getByRole("cell", { name: fx.cliente.nome })).toHaveCount(0);
});
