import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => null }));
vi.mock("@/app/(app)/financeiro/actions", () => ({ receberParcela: vi.fn() }));

import { descricaoDoRecebimento } from "./dialogo-receber";

describe("descricaoDoRecebimento", () => {
  const base = { id: "r1", clienteNome: "Maria Souza", parcela: "1/1", valorCentavos: 12000 };

  it("conta manual mostra a descrição, não 'parcela 1/1'", () => {
    const t = descricaoDoRecebimento({ ...base, descricao: "Saldo do tratamento" }).replace(/ /g, " ");
    expect(t).toBe("Maria Souza — Saldo do tratamento — R$ 120,00");
  });

  it("parcela de pagamento mostra 'parcela n/N'", () => {
    const t = descricaoDoRecebimento({ ...base, parcela: "2/3", descricao: null }).replace(/ /g, " ");
    expect(t).toBe("Maria Souza — parcela 2/3 — R$ 120,00");
  });
});
