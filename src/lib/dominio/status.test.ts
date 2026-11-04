import { describe, expect, it } from "vitest";
import { COR_STATUS, transicaoPermitida, type StatusAgendamento } from "./status";

const TODOS: StatusAgendamento[] = ["pendente", "confirmado", "atendido", "faltou", "cancelado"];

describe("COR_STATUS", () => {
  it("tem rótulo e classes para cada status", () => {
    expect(TODOS.map((s) => COR_STATUS[s].rotulo)).toEqual([
      "Pendente",
      "Confirmado",
      "Atendido",
      "Faltou",
      "Cancelado",
    ]);
    for (const s of TODOS) expect(COR_STATUS[s].fundo).toMatch(/bg-/);
  });
});

describe("transicaoPermitida", () => {
  it("recepção segue o fluxo normal", () => {
    expect(transicaoPermitida("pendente", "cancelado", "recepcao")).toBe(true);
    expect(transicaoPermitida("pendente", "atendido", "recepcao")).toBe(true);
    expect(transicaoPermitida("confirmado", "faltou", "recepcao")).toBe(true);
    expect(transicaoPermitida("confirmado", "pendente", "recepcao")).toBe(false);
  });

  it("status finais só voltam para confirmado, e só pela dona", () => {
    for (const final of ["atendido", "faltou", "cancelado"] as const) {
      expect(transicaoPermitida(final, "confirmado", "recepcao")).toBe(false);
      expect(transicaoPermitida(final, "confirmado", "profissional")).toBe(false);
      expect(transicaoPermitida(final, "confirmado", "dona")).toBe(true);
      expect(transicaoPermitida(final, "pendente", "dona")).toBe(false);
    }
  });

  it("profissional só vai para confirmado, atendido ou faltou", () => {
    expect(transicaoPermitida("confirmado", "cancelado", "profissional")).toBe(false);
    expect(transicaoPermitida("pendente", "cancelado", "profissional")).toBe(false);
    expect(transicaoPermitida("confirmado", "atendido", "profissional")).toBe(true);
    expect(transicaoPermitida("pendente", "confirmado", "profissional")).toBe(true);
    expect(transicaoPermitida("pendente", "faltou", "profissional")).toBe(true);
  });

  it("mesmo status não é transição", () => {
    for (const s of TODOS) {
      expect(transicaoPermitida(s, s, "dona")).toBe(false);
    }
  });
});
