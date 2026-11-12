import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ROBO_PADRAO,
  TEXTO_FALAR_COM_EQUIPE,
  TEXTO_SEM_LINK,
  linkAgendamentoEfetivo,
  montarMenu,
  renderizarRobo,
  respostaOpcao,
  textoHorario,
  type OpcaoRobo,
} from "./robo";

const OPCOES: OpcaoRobo[] = [
  { numero: 3, rotulo: "Endereço e horário", tipo: "texto", resposta: "Estamos em {endereco}. Horário: {horario}.", ativo: true },
  { numero: 1, rotulo: "Serviços e preços", tipo: "texto", resposta: "Veja", ativo: true },
  { numero: 2, rotulo: "Agendar horário", tipo: "agendar_online", resposta: null, ativo: false },
  { numero: 4, rotulo: "Falar com a equipe", tipo: "falar_com_equipe", resposta: null, ativo: true },
];

const SEMANA = {
  "1": [{ inicio: "09:00", fim: "18:00" }],
  "2": [{ inicio: "09:00", fim: "18:00" }],
  "3": [{ inicio: "09:00", fim: "18:00" }],
  "4": [{ inicio: "09:00", fim: "18:00" }],
  "5": [{ inicio: "09:00", fim: "18:00" }],
  "6": [{ inicio: "09:00", fim: "13:00" }],
};

describe("renderizarRobo", () => {
  it("troca as variáveis com o primeiro nome", () => {
    expect(
      renderizarRobo(ROBO_PADRAO.boasVindas, { nome: "  Maria  Silva", clinica: "Madame Fê" }),
    ).toBe("Oi, Maria! 💕 Sou a assistente virtual da Madame Fê. Escolha uma opção digitando o número:");
  });

  it("sem nome, some a vírgula: 'Oi!'", () => {
    expect(renderizarRobo("Oi, {nome}! Tudo bem?", { nome: "" })).toBe("Oi! Tudo bem?");
    expect(renderizarRobo("Oi {nome}!", { nome: null })).toBe("Oi!");
  });

  it("endereço, horário e variável desconhecida", () => {
    expect(
      renderizarRobo("Em {endereco} ({horario}) {outra}", { endereco: "Rua A", horario: "seg 09:00 às 10:00" }),
    ).toBe("Em Rua A (seg 09:00 às 10:00) {outra}");
  });
});

describe("textoHorario", () => {
  it("agrupa dias seguidos iguais", () => {
    expect(textoHorario(SEMANA)).toBe("seg a sex 09:00 às 18:00; sáb 09:00 às 13:00");
  });

  it("dois dias seguidos com 'e', vários intervalos e domingo no fim", () => {
    expect(
      textoHorario({
        "1": [{ inicio: "14:00", fim: "18:00" }, { inicio: "09:00", fim: "12:00" }],
        "2": [{ inicio: "09:00", fim: "12:00" }, { inicio: "14:00", fim: "18:00" }],
        "0": [{ inicio: "10:00:00", fim: "12:00:00" }],
      }),
    ).toBe("seg e ter 09:00 às 12:00 e 14:00 às 18:00; dom 10:00 às 12:00");
  });

  it("sem dia aberto ou malformado", () => {
    expect(textoHorario({})).toBe("consulte a equipe");
    expect(textoHorario(null)).toBe("consulte a equipe");
    expect(textoHorario({ "1": "x" })).toBe("consulte a equipe");
  });
});

describe("montarMenu", () => {
  it("boas-vindas + opções ativas em ordem", () => {
    expect(montarMenu(ROBO_PADRAO.boasVindas, OPCOES, { nome: "Maria", clinica: "Madame Fé" })).toBe(
      "Oi, Maria! 💕 Sou a assistente virtual da Madame Fé. Escolha uma opção digitando o número:\n\n" +
        "1 - Serviços e preços\n3 - Endereço e horário\n4 - Falar com a equipe",
    );
  });

  it("sem opções ativas: só as boas-vindas", () => {
    expect(montarMenu("Oi!", [], {})).toBe("Oi!");
  });
});

describe("respostaOpcao", () => {
  const dados = { endereco: "Rua A, 1", horario: textoHorario(SEMANA) };
  it("texto + rodapé", () => {
    expect(respostaOpcao(OPCOES[0], ROBO_PADRAO.rodapeOpcao, null, dados)).toBe(
      "Estamos em Rua A, 1. Horário: seg a sex 09:00 às 18:00; sáb 09:00 às 13:00.\n\nDigite 0 para voltar ao menu.",
    );
  });
  it("rodapé vazio → só a resposta", () => {
    expect(respostaOpcao(OPCOES[1], " ", null, dados)).toBe("Veja");
  });
  it("agendar online com e sem link", () => {
    expect(respostaOpcao(OPCOES[2], "R", "https://x.com/agendar", dados)).toBe(
      "Agende pelo link: https://x.com/agendar\n\nR",
    );
    expect(respostaOpcao(OPCOES[2], "", null, dados)).toBe(TEXTO_SEM_LINK);
  });
  it("falar com a equipe ignora o rodapé", () => {
    expect(respostaOpcao(OPCOES[3], "R", null, dados)).toBe(TEXTO_FALAR_COM_EQUIPE);
  });
});

describe("textos iguais aos da migração 0017", () => {
  const sql = readFileSync("supabase/migrations/0017_robo.sql", "utf8");
  it("padrões de robo_config e textos fixos", () => {
    for (const t of [...Object.values(ROBO_PADRAO), TEXTO_FALAR_COM_EQUIPE, TEXTO_SEM_LINK]) {
      expect(sql).toContain(`'${t}'`);
    }
  });
});

describe("linkAgendamentoEfetivo", () => {
  it("link próprio > link do site > nenhum", () => {
    expect(linkAgendamentoEfetivo(" https://a.com/x ", "https://site.com/agendar")).toBe("https://a.com/x");
    expect(linkAgendamentoEfetivo("  ", "https://site.com/agendar")).toBe("https://site.com/agendar");
    expect(linkAgendamentoEfetivo(null, null)).toBeNull();
  });
});
