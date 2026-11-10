import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => null }));

import { ListaContasVencendo } from "@/features/inicio/cartoes";

describe("ListaContasVencendo (Server Component)", () => {
  it("renderiza com contas e não importa módulo 'use client'", () => {
    const html = renderToStaticMarkup(
      ListaContasVencendo({
        itens: [
          {
            chave: "pagar:p1",
            conta: { tipo: "pagar", id: "p1", nome: "Aluguel", valorCentavos: 350000, vencimento: "2026-11-13" },
            dias: -2,
            texto: "vencida há 2 dias",
            href: "/financeiro?aba=pagar&conta=p1&situacao=vencida",
          },
        ],
      }),
    );
    expect(html).toContain("Aluguel");
    expect(html).toContain("vencida há 2 dias");
    expect(html).toContain("situacao=vencida");
    const fonte = readFileSync("src/features/inicio/cartoes.tsx", "utf8");
    expect(fonte).not.toContain("avisos/sininho");
  });
});
