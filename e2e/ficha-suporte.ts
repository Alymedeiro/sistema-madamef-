// Preparação e atalhos compartilhados pelos E2E da ficha clínica (só projeto de testes).
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { AMBIENTE, USUARIOS } from "./suporte";

export function clienteAdmin(): SupabaseClient {
  return createClient(AMBIENTE.url!, AMBIENTE.service!, { auth: { persistSession: false } });
}

export async function entrar(page: Page, email: string, senha: string) {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(senha);
  await page.getByRole("button", { name: "Entrar" }).click();
  await page.waitForURL("**/inicio");
}

export const dataEm = (dias: number) =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Sao_Paulo" }).format(
    new Date(Date.now() + dias * 24 * 3600 * 1000),
  );

export type FixtureFicha = {
  data: string;
  hora: string;
  profissional: { id: string; nome: string };
  cliente: { id: string; nome: string };
  servicoNome: string;
  agendamentoId: string;
};

export async function profissionalDeTeste(admin: SupabaseClient) {
  const { data: lista, error } = await admin.auth.admin.listUsers({ perPage: 1000 });
  if (error) throw error;
  const u = lista.users.find((x) => x.email?.toLowerCase() === USUARIOS.profissional.email.toLowerCase());
  if (!u) throw new Error(`Usuário ${USUARIOS.profissional.email} não existe no projeto de teste.`);
  const { data, error: ep } = await admin
    .from("colaboradores")
    .select("id, nome")
    .eq("usuario_auth_id", u.id)
    .single();
  if (ep) throw ep;
  return data as { id: string; nome: string };
}

/**
 * Cria uma cliente nova, um serviço com termo próprio (preço R$ 100,00) e um atendimento
 * confirmado da profissional de teste em `dataEm(5)`, na hora indicada (um horário por
 * viewport, para os projetos paralelos não se atropelarem).
 */
export async function prepararFicha(admin: SupabaseClient, hora: string): Promise<FixtureFicha> {
  const profissional = await profissionalDeTeste(admin);
  const sufixo = `${Date.now()}-${hora}`;

  const { data: base, error: eb } = await admin
    .from("servicos")
    .select("categoria_id")
    .eq("ativo", true)
    .limit(1)
    .single();
  if (eb) throw eb;
  const { data: termo, error: et } = await admin
    .from("modelos_termo")
    .insert({ titulo: `Termo E2E ${sufixo}`, texto: "# Termo de consentimento\nDeclaro que fui informada sobre o procedimento.", versao: 1, ativo: true })
    .select("id")
    .single();
  if (et) throw et;
  const servicoNome = `Serviço E2E Ficha ${sufixo}`;
  const { data: servico, error: es } = await admin
    .from("servicos")
    .insert({
      nome: servicoNome,
      categoria_id: base.categoria_id,
      duracao_min: 60,
      preco_centavos: 10000,
      modelo_termo_id: termo.id,
    })
    .select("id, preco_centavos")
    .single();
  if (es) throw es;
  await admin.from("colaborador_servicos").insert({ colaborador_id: profissional.id, servico_id: servico.id });

  const { data: cliente, error: ec } = await admin
    .from("clientes")
    .insert({ nome: `Cliente E2E Ficha ${sufixo}`, aceite_lgpd_em: new Date().toISOString() })
    .select("id, nome")
    .single();
  if (ec) throw ec;

  const data = dataEm(5);
  const h = hora.padStart(2, "0");
  await admin
    .from("agendamentos")
    .delete()
    .eq("profissional_id", profissional.id)
    .gte("inicio", `${data}T${h}:00:00-03:00`)
    .lt("inicio", `${data}T${h}:59:00-03:00`);
  const { data: ag, error: ea } = await admin
    .from("agendamentos")
    .insert({
      cliente_id: cliente.id,
      profissional_id: profissional.id,
      servico_id: servico.id,
      inicio: `${data}T${h}:00:00-03:00`,
      fim: `${data}T${String(Number(h) + 1).padStart(2, "0")}:00:00-03:00`,
      status: "confirmado",
      valor_previsto_centavos: servico.preco_centavos,
    })
    .select("id")
    .single();
  if (ea) throw ea;
  return { data, hora: h, profissional, cliente, servicoNome, agendamentoId: ag.id };
}

/** Grava duas fotos (antes/depois) direto no bucket e na tabela, sem passar pela tela. */
export async function semearFotos(admin: SupabaseClient, f: FixtureFicha) {
  for (const [arquivo, tipo] of [
    ["foto-1.jpg", "antes"],
    ["foto-2.jpg", "depois"],
  ] as const) {
    const path = `clientes/${f.cliente.id}/fotos/${randomUUID()}.jpg`;
    const corpo = await readFile(`e2e/fixtures/${arquivo}`);
    const { error: eu } = await admin.storage
      .from("ficha-clinica")
      .upload(path, corpo, { contentType: "image/jpeg" });
    if (eu) throw eu;
    const { error } = await admin.from("fotos").insert({
      cliente_id: f.cliente.id,
      agendamento_id: f.agendamentoId,
      tipo,
      path,
      enviada_por: f.profissional.id,
    });
    if (error) throw error;
  }
}

/** Desenha um traço de três pontos no primeiro campo de assinatura da página. */
export async function assinar(page: Page) {
  const area = page.getByRole("img", { name: "Área de assinatura" });
  const caixa = (await area.boundingBox())!;
  await page.mouse.move(caixa.x + 40, caixa.y + 60);
  await page.mouse.down();
  await page.mouse.move(caixa.x + 120, caixa.y + 150, { steps: 6 });
  await page.mouse.move(caixa.x + 200, caixa.y + 80, { steps: 6 });
  await page.mouse.up();
}
