import { describe, expect, it } from "vitest";
import { tempoRestante } from "./prazo";

const agora = new Date("2026-11-08T12:00:00Z");

describe("tempoRestante", () => {
  it("horas e minutos até expirar", () => {
    expect(tempoRestante("2026-11-09T03:20:00Z", agora)).toBe("expira em 15 h 20 min");
    expect(tempoRestante("2026-11-08T14:00:00Z", agora)).toBe("expira em 2 h");
    expect(tempoRestante("2026-11-08T12:09:30Z", agora)).toBe("expira em 9 min");
  });

  it("menos de 1 minuto ou vencido", () => {
    expect(tempoRestante("2026-11-08T12:00:30Z", agora)).toBe("expira em menos de 1 min");
    expect(tempoRestante("2026-11-08T11:00:00Z", agora)).toBe("expirado");
  });
});
