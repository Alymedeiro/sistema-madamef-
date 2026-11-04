// Utilidades compartilhadas pelos E2E que dependem de um projeto Supabase de teste.
// Sem as variáveis/backend, os testes são pulados com mensagem explícita (Ruling R3).
import { test } from "@playwright/test";

export const AMBIENTE = {
  url: process.env.NEXT_PUBLIC_SUPABASE_URL,
  anon: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  service: process.env.SUPABASE_SERVICE_ROLE_KEY,
};

export const USUARIOS = {
  dona: {
    email: process.env.E2E_DONA_EMAIL ?? "e2e-dona@madamefe.test",
    senha: process.env.E2E_DONA_SENHA ?? "E2e-Senha-123!",
    nome: "Dona E2E",
  },
  recepcao: {
    email: process.env.E2E_RECEPCAO_EMAIL ?? "e2e-recepcao@madamefe.test",
    senha: process.env.E2E_RECEPCAO_SENHA ?? "E2e-Senha-123!",
    nome: "Recepção E2E",
  },
  profissional: {
    email: process.env.E2E_PROFISSIONAL_EMAIL ?? "e2e-profissional@madamefe.test",
    senha: process.env.E2E_PROFISSIONAL_SENHA ?? "E2e-Senha-123!",
    nome: "Profissional E2E",
  },
  profissional2: {
    email: process.env.E2E_PROFISSIONAL2_EMAIL ?? "e2e-profissional2@madamefe.test",
    senha: process.env.E2E_PROFISSIONAL2_SENHA ?? "E2e-Senha-123!",
    nome: "Profissional 2 E2E",
  },
} as const;

export type PerfilE2E = "dona" | "recepcao" | "profissional";

export const ARQUIVO_ESTADO = (perfil: PerfilE2E) => `e2e/.auth/${perfil}.json`;
export const ARQUIVO_FIXTURES = "e2e/.auth/fixtures.json";

export function variaveisFaltando(): string[] {
  return Object.entries(AMBIENTE)
    .filter(([, v]) => !v)
    .map(([k]) => ({ url: "NEXT_PUBLIC_SUPABASE_URL", anon: "NEXT_PUBLIC_SUPABASE_ANON_KEY", service: "SUPABASE_SERVICE_ROLE_KEY" })[k]!);
}

export async function backendAlcancavel(): Promise<boolean> {
  try {
    const r = await fetch(`${AMBIENTE.url}/auth/v1/health`, {
      headers: { apikey: AMBIENTE.anon! },
      signal: AbortSignal.timeout(5000),
    });
    return r.ok;
  } catch {
    return false;
  }
}

/** Pula o bloco atual com mensagem clara quando não há backend de teste. */
export async function pularSemBackend(nome: string): Promise<void> {
  const faltando = variaveisFaltando();
  test.skip(
    faltando.length > 0,
    `${nome} pulado: defina ${faltando.join(", ")} (projeto Supabase de teste, Ruling R3).`,
  );
  test.skip(
    !(await backendAlcancavel()),
    `${nome} pulado: ${AMBIENTE.url} não responde (sem backend Supabase alcançável, Ruling R3).`,
  );
}
