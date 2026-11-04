import { describe, expect, it } from "vitest";
import {
  MAX_SESSOES,
  pacoteUtilizavel,
  progressoPacote,
  ROTULO_STATUS_PACOTE,
  statusEfetivoPacote,
  sugestaoValorPacote,
} from "./pacotes";

const p = {
  id: "p",
  servicoId: "s",
  status: "ativo",
  validade: "2026-11-03",
  sessoesUsadas: 2,
  totalSessoes: 10,
} as const;

describe("pacotes (domínio)", () => {
  it("constantes e rótulos", () => {
    expect(MAX_SESSOES).toBe(50);
    expect(ROTULO_STATUS_PACOTE).toEqual({
      ativo: "Ativo",
      concluido: "Concluído",
      expirado: "Expirado",
      cancelado: "Cancelado",
    });
  });

  it("status efetivo: vencido, vale até o fim do dia, sem validade, concluído", () => {
    expect(statusEfetivoPacote(p, "2026-11-04")).toBe("expirado");
    expect(statusEfetivoPacote({ ...p, validade: "2026-11-04" }, "2026-11-04")).toBe("ativo");
    expect(statusEfetivoPacote({ ...p, validade: null }, "2030-01-01")).toBe("ativo");
    expect(statusEfetivoPacote({ ...p, status: "concluido", sessoesUsadas: 10 }, "2026-11-04")).toBe(
      "concluido",
    );
  });

  it("ativo vencido sem sessões restantes não expira", () => {
    expect(statusEfetivoPacote({ ...p, sessoesUsadas: 10 }, "2026-11-04")).toBe("ativo");
  });

  it("utilizável: serviço, status efetivo e sessões restantes", () => {
    expect(pacoteUtilizavel({ ...p, validade: null }, "s", "2026-11-04")).toBe(true);
    expect(pacoteUtilizavel({ ...p, validade: null }, "outro", "2026-11-04")).toBe(false);
    expect(pacoteUtilizavel(p, "s", "2026-11-04")).toBe(false);
    expect(pacoteUtilizavel({ ...p, validade: null, sessoesUsadas: 10 }, "s", "2026-11-04")).toBe(false);
    expect(pacoteUtilizavel({ ...p, validade: null, status: "cancelado" }, "s", "2026-11-04")).toBe(false);
  });

  it("progresso e sugestão de valor", () => {
    expect(progressoPacote(3, 10)).toEqual({ restantes: 7, percentual: 30 });
    expect(progressoPacote(1, 3)).toEqual({ restantes: 2, percentual: 33 });
    expect(progressoPacote(0, 0)).toEqual({ restantes: 0, percentual: 0 });
    expect(sugestaoValorPacote(25000, 4)).toBe(100000);
  });
});
