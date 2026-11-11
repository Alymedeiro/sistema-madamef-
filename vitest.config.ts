import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // O tsconfig do Next usa jsx "preserve"; nos testes o JSX vira chamadas do React.
  oxc: { jsx: { runtime: "automatic" } },
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx", "e2e/*.unit.ts"],
    // Garante que os testes de domínio não dependam do fuso do aparelho.
    env: { TZ: "UTC" },
  },
});
