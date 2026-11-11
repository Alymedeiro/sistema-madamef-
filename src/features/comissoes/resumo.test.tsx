import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));
vi.mock("@/lib/sessao", () => ({ exigirPerfil: async () => ({}) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => null }));

import { ResumoComissoes } from "./resumo";

const linha = (extra: Partial<Parameters<typeof ResumoComissoes>[0]["resumo"][number]>) => ({
  profissionalId: "a1",
  nome: "Ana",
  competencia: "2026-11-01",
  qtd: 2,
  baseCentavos: 20000,
  abertoCentavos: 0,
  pagoCentavos: 0,
  abertas: 0,
  ...extra,
});

const render = (resumo: ReturnType<typeof linha>[]) =>
  renderToStaticMarkup(
    <ResumoComissoes resumo={resumo} totais={{ abertoCentavos: 0, pagoCentavos: 0 }} hoje="2026-11-11" />,
  );

describe("ResumoComissoes", () => {
  it("todas a 0% em aberto (a pagar R$ 0,00): mostra Pagar comissões", () => {
    const html = render([linha({ abertas: 2, abertoCentavos: 0 })]);
    expect(html).toContain("Pagar comissões");
    expect(html).toContain("11/2026");
  });

  it("nada em aberto (tudo pago): sem botão", () => {
    expect(render([linha({ abertas: 0, pagoCentavos: 5000 })])).not.toContain("Pagar comissões");
  });
});
