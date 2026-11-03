import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Testes de banco (RLS, restrições, funções) contra o PostgreSQL local — Ruling R1.
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["supabase/tests/**/*.db.test.ts"],
    // Todos os arquivos recriam o mesmo banco `madame_test`: um de cada vez.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    env: { TZ: "UTC" },
  },
});
