import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { MINUTOS_ARQUIVO, MSG_COMISSAO_PAGA, horarioArquivado, liberarHorario } from "./horario-livre";

describe("horarioArquivado", () => {
  it("1 minuto entre 2000 e 2009, determinístico por id; a tentativa anda um minuto", () => {
    const a = horarioArquivado("3f1c6a1e-0000-4000-8000-000000000001");
    expect(a).toEqual(horarioArquivado("3f1c6a1e-0000-4000-8000-000000000001"));
    expect(new Date(a.fim).getTime() - new Date(a.inicio).getTime()).toBe(60_000);
    expect(a.inicio >= "2000-01-01T00:00:00.000Z" && a.fim <= "2010-01-01T00:00:00.000Z").toBe(true);
    const b = horarioArquivado("3f1c6a1e-0000-4000-8000-000000000001", 1);
    expect(new Date(b.inicio).getTime() - new Date(a.inicio).getTime()).toBe(60_000);
    expect(horarioArquivado("outro-id").inicio).not.toBe(a.inicio);
  });

  it("dá a volta no fim do espaço arquivado", () => {
    for (const id of ["a", "b", "c", "d"]) {
      const ultimo = horarioArquivado(id, MINUTOS_ARQUIVO - 1);
      expect(ultimo.fim <= "2010-01-01T00:00:00.000Z").toBe(true);
      expect(horarioArquivado(id, MINUTOS_ARQUIVO)).toEqual(horarioArquivado(id));
    }
  });
});

type Erro = { code?: string; message?: string } | null;

/** Cliente falso: guarda os filtros da consulta e responde às atualizações por um roteiro. */
function clienteFalso(ids: string[], respostas: (patch: Record<string, unknown>, id: string) => Erro) {
  const filtros: unknown[][] = [];
  const atualizacoes: { id: string; patch: Record<string, unknown> }[] = [];
  const admin = {
    from(tabela: string) {
      expect(tabela).toBe("agendamentos");
      return {
        select() {
          const consulta = {
            eq: (...a: unknown[]) => (filtros.push(["eq", ...a]), consulta),
            neq: (...a: unknown[]) => (filtros.push(["neq", ...a]), consulta),
            gte: (...a: unknown[]) => (filtros.push(["gte", ...a]), consulta),
            lt: (...a: unknown[]) => (
              filtros.push(["lt", ...a]), Promise.resolve({ data: ids.map((id) => ({ id })), error: null })
            ),
          };
          return consulta;
        },
        update(patch: Record<string, unknown>) {
          return {
            eq: async (_coluna: string, id: string) => {
              atualizacoes.push({ id, patch });
              return { error: respostas(patch, id) };
            },
          };
        },
      };
    },
  } as unknown as SupabaseClient;
  return { admin, filtros, atualizacoes };
}

describe("liberarHorario", () => {
  const DE = "2026-11-16T15:00:00-03:00";
  const ATE = "2026-11-16T16:00:00-03:00";

  it("procura os não cancelados da profissional que começam em [de, ate) e cancela", async () => {
    const f = clienteFalso(["a1", "a2"], () => null);
    await liberarHorario(f.admin, "prof", DE, ATE);
    expect(f.filtros).toEqual([
      ["eq", "profissional_id", "prof"],
      ["neq", "status", "cancelado"],
      ["gte", "inicio", DE],
      ["lt", "inicio", ATE],
    ]);
    expect(f.atualizacoes).toEqual([
      { id: "a1", patch: { status: "cancelado" } },
      { id: "a2", patch: { status: "cancelado" } },
    ]);
  });

  it("comissão paga: arquiva no passado; 23P01 tenta o minuto seguinte", async () => {
    let arquivamentos = 0;
    const f = clienteFalso(["pago"], (patch) => {
      if ("status" in patch) return { code: "P0001", message: MSG_COMISSAO_PAGA };
      arquivamentos += 1;
      return arquivamentos === 1 ? { code: "23P01", message: "sobreposição" } : null;
    });
    await liberarHorario(f.admin, "prof", DE, ATE);
    expect(f.atualizacoes).toEqual([
      { id: "pago", patch: { status: "cancelado" } },
      { id: "pago", patch: horarioArquivado("pago", 0) },
      { id: "pago", patch: horarioArquivado("pago", 1) },
    ]);
  });

  it("outros erros sobem", async () => {
    const outro = { code: "42501", message: "permission denied" };
    await expect(liberarHorario(clienteFalso(["x"], () => outro).admin, "prof", DE, ATE)).rejects.toBe(outro);
    const arquivo = { code: "P0001", message: "Há um pedido online neste horário." };
    const f = clienteFalso(["y"], (patch) =>
      "status" in patch ? { code: "P0001", message: MSG_COMISSAO_PAGA } : arquivo,
    );
    await expect(liberarHorario(f.admin, "prof", DE, ATE)).rejects.toBe(arquivo);
    expect(f.atualizacoes).toHaveLength(2);
  });
});
