// Utilidades compartilhadas pelos E2E que dependem de um projeto Supabase de teste.
// Sem as variáveis/backend, os testes são pulados com mensagem explícita (Ruling R3).
import { test } from "@playwright/test";
import { avaliarGuarda } from "./guarda";

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

/**
 * Guarda única de todos os E2E que escrevem no backend: exige autorização explícita do
 * projeto (E2E_PERMITIR_PROJETO, ver guarda.ts) e que ele responda. Senão, pula.
 */
export async function pularSemBackend(nome: string): Promise<void> {
  const g = avaliarGuarda({
    url: AMBIENTE.url,
    anon: AMBIENTE.anon,
    service: AMBIENTE.service,
    permitirProjeto: process.env.E2E_PERMITIR_PROJETO,
    baseUrl: process.env.E2E_BASE_URL,
    baseUrlPermitida: process.env.E2E_BASE_URL_PERMITIDA,
  });
  test.skip(!g.permitido, `${nome} pulado: ${g.permitido ? "" : g.motivo} (Ruling R3).`);
  test.skip(
    !(await backendAlcancavel()),
    `${nome} pulado: ${AMBIENTE.url} não responde (sem backend Supabase alcançável, Ruling R3).`,
  );
}
