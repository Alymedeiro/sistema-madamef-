import { describe, expect, it } from "vitest";
import {
  alertasDaAnamnese,
  anamnesePendente,
  erroDasPerguntas,
  errosDasRespostas,
  gerarIdPergunta,
  precisaNovaVersao,
  respostasLegiveis,
  type Pergunta,
  type Respostas,
} from "./anamnese";

const P: Pergunta[] = [
  { id: "queixa", tipo: "texto", texto: "Qual é a sua principal queixa ou objetivo?", obrigatoria: true, alerta: false },
  { id: "alergias", tipo: "sim_nao_detalhe", texto: "Tem alguma alergia (medicamentos, cosméticos, alimentos)?", obrigatoria: true, alerta: true },
  { id: "gestante", tipo: "sim_nao", texto: "Está grávida ou amamentando?", obrigatoria: true, alerta: true },
  { id: "condicoes", tipo: "multipla", texto: "Tem ou já teve alguma destas condições?", obrigatoria: false, alerta: false, opcoes: ["Diabetes", "Nenhuma"] },
  { id: "sol", tipo: "sim_nao", texto: "Tem exposição frequente ao sol?", obrigatoria: false, alerta: false },
  { id: "desde", tipo: "data", texto: "Desde quando?", obrigatoria: false },
];
const completas: Respostas = {
  queixa: "Manchas",
  alergias: { sim: false, detalhe: "" },
  gestante: false,
};
const agora = new Date("2026-11-04T12:00:00Z");

describe("errosDasRespostas", () => {
  it("obrigatória sem resposta", () => {
    expect(errosDasRespostas(P, { queixa: "Manchas" })).toMatchObject({
      gestante: "Responda: Está grávida ou amamentando?",
    });
  });
  it("texto só com espaços e múltipla vazia contam como sem resposta", () => {
    const e = errosDasRespostas(
      [{ ...P[0] }, { ...P[3], obrigatoria: true }],
      { queixa: "  ", condicoes: [] },
    );
    expect(Object.keys(e)).toEqual(["queixa", "condicoes"]);
  });
  it("não é erro quando está completo; falso (Não) é resposta", () => {
    expect(errosDasRespostas(P, completas)).toEqual({});
  });
  it("sim sem detalhe", () => {
    expect(
      errosDasRespostas(P, { ...completas, alergias: { sim: true, detalhe: " " } }).alergias,
    ).toBe("Conte mais sobre: Tem alguma alergia (medicamentos, cosméticos, alimentos)?");
  });
});

describe("alertasDaAnamnese", () => {
  it("lista alertas respondidos sim, com detalhe", () => {
    expect(
      alertasDaAnamnese(P, { ...completas, gestante: true, alergias: { sim: true, detalhe: "dipirona" } }),
    ).toEqual([
      "Tem alguma alergia (medicamentos, cosméticos, alimentos)? (dipirona)",
      "Está grávida ou amamentando?",
    ]);
  });
  it("pergunta que não é de alerta não entra", () => {
    expect(alertasDaAnamnese(P, { ...completas, sol: true })).toEqual([]);
  });
});

describe("respostasLegiveis", () => {
  it("usa as perguntas da própria versão", () => {
    const V1: Pergunta[] = [{ id: "antiga", tipo: "sim_nao", texto: "Pergunta só da v1", obrigatoria: false }];
    expect(respostasLegiveis(V1, { antiga: true })).toEqual([
      { pergunta: "Pergunta só da v1", resposta: "Sim", alerta: false },
    ]);
  });
  it("formata cada tipo", () => {
    const r = respostasLegiveis(P, {
      queixa: "Manchas",
      alergias: { sim: true, detalhe: "dipirona" },
      gestante: false,
      condicoes: ["Diabetes", "Nenhuma"],
      desde: "2026-03-09",
    });
    expect(r.map((i) => i.resposta)).toEqual([
      "Manchas",
      "Sim — dipirona",
      "Não",
      "Diabetes, Nenhuma",
      "—",
      "09/03/2026",
    ]);
    expect(r[1].alerta).toBe(true);
  });
});

describe("anamnesePendente", () => {
  it("sem anamnese ou com mais de 12 meses", () => {
    expect(anamnesePendente(null, agora)).toBe(true);
    expect(anamnesePendente("2025-11-05T12:00:00Z", agora)).toBe(false);
    expect(anamnesePendente("2025-11-03T12:00:00Z", agora)).toBe(true);
  });
});

describe("modelo", () => {
  it("erroDasPerguntas", () => {
    expect(erroDasPerguntas([])).toBe("Adicione ao menos uma pergunta.");
    expect(erroDasPerguntas([{ id: "a", tipo: "texto", texto: " ", obrigatoria: false }])).toBe("Toda pergunta precisa de texto.");
    expect(
      erroDasPerguntas([
        { id: "a", tipo: "texto", texto: "A", obrigatoria: false },
        { id: "a", tipo: "texto", texto: "B", obrigatoria: false },
      ]),
    ).toBe("Há perguntas repetidas.");
    expect(
      erroDasPerguntas([{ id: "a", tipo: "multipla", texto: "A", obrigatoria: false, opcoes: ["x"] }]),
    ).toBe("Perguntas de múltipla escolha precisam de ao menos 2 opções.");
    expect(erroDasPerguntas([{ id: "a", tipo: "texto", texto: "A", obrigatoria: false, alerta: true }])).toBe(
      "Só perguntas de sim/não podem ser de alerta.",
    );
    expect(erroDasPerguntas(P)).toBeNull();
  });
  it("gerarIdPergunta", () => {
    expect(gerarIdPergunta("Usa ácido?", [])).toBe("usa_acido");
    expect(gerarIdPergunta("Usa ácido?", ["usa_acido"])).toBe("usa_acido_2");
    expect(gerarIdPergunta("Usa ácido?", ["usa_acido", "usa_acido_2"])).toBe("usa_acido_3");
    expect(gerarIdPergunta("???", [])).toMatch(/^[a-z0-9_]{1,40}$/);
    expect(gerarIdPergunta("a".repeat(80), [])).toMatch(/^[a-z0-9_]{1,40}$/);
  });
  it("precisaNovaVersao", () => {
    expect(precisaNovaVersao(P, P, "T", "T")).toBe(false);
    expect(precisaNovaVersao(P, P, "T", "U")).toBe(true);
    expect(precisaNovaVersao(P, [...P].reverse(), "T", "T")).toBe(true);
    expect(precisaNovaVersao(P, P.slice(1), "T", "T")).toBe(true);
    expect(precisaNovaVersao(P, P.map((p) => ({ ...p, alerta: p.alerta ?? false })), "T", "T")).toBe(false);
  });
});

describe("errosDasRespostas — forma por tipo", () => {
  const q = (p: Partial<Pergunta> & Pick<Pergunta, "tipo">): Pergunta[] => [
    { id: "x", texto: "Q?", obrigatoria: false, ...p },
  ];
  const invalida = (ps: Pergunta[], v: unknown) =>
    errosDasRespostas(ps, { x: v as never }).x;

  it("texto", () => {
    const ps = q({ tipo: "texto" });
    expect(errosDasRespostas(ps, { x: "ok" })).toEqual({});
    expect(errosDasRespostas(ps, {})).toEqual({});
    expect(invalida(ps, true)).toBe("Resposta inválida: Q?");
    expect(invalida(ps, ["a"])).toBe("Resposta inválida: Q?");
    expect(invalida(ps, "a".repeat(2001))).toBe("Resposta inválida: Q?");
  });
  it("sim_nao", () => {
    const ps = q({ tipo: "sim_nao" });
    expect(errosDasRespostas(ps, { x: false })).toEqual({});
    expect(invalida(ps, "sim")).toBe("Resposta inválida: Q?");
  });
  it("sim_nao_detalhe", () => {
    const ps = q({ tipo: "sim_nao_detalhe" });
    expect(errosDasRespostas(ps, { x: { sim: false, detalhe: "" } })).toEqual({});
    expect(errosDasRespostas(ps, { x: { sim: true, detalhe: "algo" } })).toEqual({});
    expect(invalida(ps, true)).toBe("Resposta inválida: Q?");
    expect(invalida(ps, { sim: "s", detalhe: "" })).toBe("Resposta inválida: Q?");
    expect(invalida(ps, { sim: true, detalhe: 3 })).toBe("Resposta inválida: Q?");
    expect(invalida(ps, { sim: true, detalhe: "" })).toBe("Conte mais sobre: Q?");
  });
  it("multipla", () => {
    const ps = q({ tipo: "multipla", opcoes: ["A", "B"] });
    expect(errosDasRespostas(ps, { x: ["A", "B"] })).toEqual({});
    expect(errosDasRespostas(ps, { x: [] })).toEqual({});
    expect(invalida(ps, ["C"])).toBe("Resposta inválida: Q?");
    expect(invalida(ps, ["A", "A"])).toBe("Resposta inválida: Q?");
    expect(invalida(ps, "A")).toBe("Resposta inválida: Q?");
  });
  it("data", () => {
    const ps = q({ tipo: "data" });
    expect(errosDasRespostas(ps, { x: "2026-02-28" })).toEqual({});
    expect(invalida(ps, "2026-02-30")).toBe("Resposta inválida: Q?");
    expect(invalida(ps, "09/03/2026")).toBe("Resposta inválida: Q?");
    expect(invalida(ps, true)).toBe("Resposta inválida: Q?");
  });
});
