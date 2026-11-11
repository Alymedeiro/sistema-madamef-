import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => null }));
vi.mock("@/app/(app)/financeiro/actions", () => ({ receberParcela: vi.fn() }));

import type { ContaReceberLinha } from "@/app/(app)/financeiro/dados-receber";
import { ReceberHoje } from "./receber-hoje";

const parcela = {
  id: "r1",
  clienteNome: "Maria Souza",
  descricao: null,
  parcela: "1/2",
  valorCentavos: 5000,
  vencimento: "2026-11-10",
  situacao: "em_aberto",
} as unknown as ContaReceberLinha;

const html = (caixa: "aberto" | "fechado" | "sem") =>
  renderToStaticMarkup(ReceberHoje({ parcelas: [parcela], caixa }));

describe("ReceberHoje", () => {
  it("caixa de hoje fechado: avisa que já foi fechado", () => {
    expect(html("fechado")).toContain("O caixa de hoje já foi fechado.");
    expect(html("fechado")).not.toContain("Abra o caixa do dia antes de receber.");
  });

  it("caixa não aberto: pede para abrir", () => {
    expect(html("sem")).toContain("Abra o caixa do dia antes de receber.");
  });

  it("caixa aberto: sem dica", () => {
    const h = html("aberto");
    expect(h).not.toContain("Abra o caixa");
    expect(h).not.toContain("já foi fechado");
  });
});
