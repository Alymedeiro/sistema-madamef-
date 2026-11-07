import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.PORT ?? 3000);
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`;

// Neste ambiente o Chromium vem pré-instalado em /opt/pw-browsers.
const CHROMIUM_LOCAL = "/opt/pw-browsers/chromium";
const launchOptions = existsSync(CHROMIUM_LOCAL) ? { executablePath: CHROMIUM_LOCAL } : {};

// Sem projeto Supabase de teste, o servidor sobe com valores falsos: serve às telas
// que não precisam de backend (login, esqueci-senha). Os E2E que precisam são pulados.
const backendReal = !!(
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);
const ambienteServidor: Record<string, string> = backendReal
  ? {}
  : {
      NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "chave-anonima-falsa-para-e2e-visual",
    };

const viewport = (width: number, height: number, extra: object = {}) => ({
  ...devices["Desktop Chrome"],
  viewport: { width, height },
  launchOptions,
  ...extra,
});

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL,
    trace: "on-first-retry",
    locale: "pt-BR",
    timezoneId: "America/Sao_Paulo",
  },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/, use: viewport(1440, 900) },
    { name: "computador", dependencies: ["setup"], testIgnore: /auth\.setup\.ts/, use: viewport(1440, 900) },
    { name: "tablet", dependencies: ["setup"], testIgnore: /auth\.setup\.ts/, use: viewport(1024, 768) },
    {
      name: "celular",
      dependencies: ["setup"],
      testIgnore: /auth\.setup\.ts/,
      use: viewport(390, 844, { hasTouch: true }),
    },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: "pnpm build && pnpm start",
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 240_000,
        env: {
          ...(process.env as Record<string, string>),
          ...ambienteServidor,
          // Liga a página de apoio /e2e-harness (só neste build de teste).
          NEXT_PUBLIC_E2E_HARNESS: "1",
        },
      },
});
