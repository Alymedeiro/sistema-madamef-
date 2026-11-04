// Prepara o projeto Supabase de teste: garante dona, recepção e 2 profissionais
// (via cliente admin) e salva o storageState de cada perfil em e2e/.auth/.
// Sem backend de teste, é pulado com mensagem explícita (Ruling R3).
import { mkdir, writeFile } from "node:fs/promises";
import { expect, test as setup, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  AMBIENTE,
  ARQUIVO_ESTADO,
  ARQUIVO_FIXTURES,
  USUARIOS,
  pularSemBackend,
  type PerfilE2E,
} from "./suporte";

type Usuario = { email: string; senha: string; nome: string };

async function garantirColaborador(
  admin: SupabaseClient,
  u: Usuario,
  perfil: PerfilE2E,
): Promise<string> {
  const { data: lista, error } = await admin.auth.admin.listUsers({ perPage: 1000 });
  if (error) throw error;
  let auth = lista.users.find((x) => x.email?.toLowerCase() === u.email.toLowerCase());
  if (auth) {
    await admin.auth.admin.updateUserById(auth.id, { password: u.senha, ban_duration: "none" });
  } else {
    const { data, error: ec } = await admin.auth.admin.createUser({
      email: u.email,
      password: u.senha,
      email_confirm: true,
    });
    if (ec || !data.user) throw ec ?? new Error("Usuário não criado");
    auth = data.user;
  }
  const { data: existente } = await admin
    .from("colaboradores")
    .select("id")
    .eq("usuario_auth_id", auth.id)
    .maybeSingle();
  if (existente) {
    await admin.from("colaboradores").update({ perfil, ativo: true, nome: u.nome }).eq("id", existente.id);
    return existente.id as string;
  }
  const { data, error: ei } = await admin
    .from("colaboradores")
    .insert({ usuario_auth_id: auth.id, nome: u.nome, perfil })
    .select("id")
    .single();
  if (ei) throw ei;
  return data.id as string;
}

async function entrarESalvar(page: Page, u: Usuario, arquivo: string) {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(u.email);
  await page.getByLabel("Senha").fill(u.senha);
  await page.getByRole("button", { name: "Entrar" }).click();
  await page.waitForURL("**/inicio");
  await page.context().storageState({ path: arquivo });
}

setup("cria usuários de teste e salva a sessão de cada perfil", async ({ browser }) => {
  setup.setTimeout(120_000);
  await pularSemBackend("Preparação dos E2E (auth.setup)");
  const admin = createClient(AMBIENTE.url!, AMBIENTE.service!, { auth: { persistSession: false } });
  await mkdir("e2e/.auth", { recursive: true });

  await garantirColaborador(admin, USUARIOS.dona, "dona");
  await garantirColaborador(admin, USUARIOS.recepcao, "recepcao");
  const profId = await garantirColaborador(admin, USUARIOS.profissional, "profissional");
  const prof2Id = await garantirColaborador(admin, USUARIOS.profissional2, "profissional");

  // Cliente atendida só pela profissional 2: a profissional 1 não pode abri-la.
  const { data: servico, error: es } = await admin
    .from("servicos")
    .select("id, preco_centavos")
    .eq("ativo", true)
    .limit(1)
    .single();
  if (es) throw es;
  const { data: cliente, error: ec } = await admin
    .from("clientes")
    .insert({ nome: `Cliente E2E Permissões ${Date.now()}`, aceite_lgpd_em: new Date().toISOString() })
    .select("id")
    .single();
  if (ec) throw ec;
  const inicio = new Date(Date.now() + 3 * 24 * 3600 * 1000);
  inicio.setUTCHours(15, 0, 0, 0);
  const fim = new Date(inicio.getTime() + 3600 * 1000);
  const { error: ea } = await admin.from("agendamentos").insert({
    cliente_id: cliente.id,
    profissional_id: prof2Id,
    servico_id: servico.id,
    inicio: inicio.toISOString(),
    fim: fim.toISOString(),
    status: "pendente",
    valor_previsto_centavos: servico.preco_centavos,
  });
  if (ea) throw ea;
  await writeFile(
    ARQUIVO_FIXTURES,
    JSON.stringify({ clienteDeOutraProfissionalId: cliente.id, profissionalId: profId }),
  );

  for (const perfil of ["dona", "recepcao", "profissional"] as const) {
    const contexto = await browser.newContext({ locale: "pt-BR", timezoneId: "America/Sao_Paulo" });
    const page = await contexto.newPage();
    await entrarESalvar(page, USUARIOS[perfil], ARQUIVO_ESTADO(perfil));
    await expect(page).toHaveURL(/\/inicio/);
    await contexto.close();
  }
});
