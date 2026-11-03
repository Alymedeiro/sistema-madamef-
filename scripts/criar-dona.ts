/**
 * Cria o primeiro usuário do sistema: um login no Supabase Auth + o colaborador
 * com perfil `dona`.
 *
 * Uso (na raiz do projeto, com `.env.local` preenchido):
 *   node --env-file=.env.local --import tsx scripts/criar-dona.ts <email> <senha> <nome>
 *   # ou, equivalente: pnpm tsx --env-file=.env.local scripts/criar-dona.ts <email> <senha> <nome>
 *   # ex.: pnpm tsx --env-file=.env.local scripts/criar-dona.ts dona@teste.local 'Senha123!' "Fernanda"
 *
 * Variáveis lidas do ambiente: NEXT_PUBLIC_SUPABASE_URL e
 * SUPABASE_SERVICE_ROLE_KEY (segredo: nunca commitar nem expor ao navegador).
 * Imprime o id do colaborador criado.
 *
 * Não importa `src/lib/supabase/admin.ts` porque ele usa `server-only`, que
 * recusa rodar fora do Next.js; o cliente aqui tem a mesma configuração.
 */
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../src/lib/supabase/tipos";

async function main(): Promise<void> {
  const [email, senha, nome] = process.argv.slice(2);
  if (!email || !senha || !nome?.trim()) {
    console.error(
      "Uso: pnpm tsx --env-file=.env.local scripts/criar-dona.ts <email> <senha> <nome>",
    );
    process.exit(1);
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    console.error(
      "Defina NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY (veja .env.example).",
    );
    process.exit(1);
  }

  const admin = createClient<Database>(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: criado, error: erroAuth } = await admin.auth.admin.createUser({
    email,
    password: senha,
    email_confirm: true,
  });
  if (erroAuth || !criado.user) {
    console.error(`Não foi possível criar o login: ${erroAuth?.message ?? "sem usuário"}`);
    process.exit(1);
  }

  const { data: colaborador, error: erroColaborador } = await admin
    .from("colaboradores")
    .insert({ usuario_auth_id: criado.user.id, nome: nome.trim(), perfil: "dona" })
    .select("id")
    .single();

  if (erroColaborador || !colaborador) {
    // Não deixa um login órfão (sem colaborador) para trás.
    await admin.auth.admin.deleteUser(criado.user.id);
    console.error(
      `Não foi possível criar o colaborador: ${erroColaborador?.message ?? "sem retorno"}`,
    );
    process.exit(1);
  }

  console.log(colaborador.id);
}

main().catch((erro: unknown) => {
  console.error(erro instanceof Error ? erro.message : erro);
  process.exit(1);
});
