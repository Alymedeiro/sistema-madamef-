import { describe, expect, it } from "vitest";
import { ROBO_PADRAO, type OpcaoRobo } from "@/lib/dominio/robo";
import { previaMenuRobo, previaRespostaRobo } from "./previa-robo";

const opcoes: OpcaoRobo[] = [
  { numero: 2, rotulo: "Agendar horário", tipo: "agendar_online", resposta: null, ativo: true },
  { numero: 1, rotulo: "Endereço", tipo: "texto", resposta: "Estamos em {endereco}. {horario}", ativo: true },
];
const d = {
  clinica: "Madame Fê",
  endereco: "Rua A, 1",
  horario: { "6": [{ inicio: "09:00", fim: "13:00" }] },
};

describe("prévia do robô", () => {
  it("menu com Maria e as opções em ordem", () => {
    expect(previaMenuRobo(ROBO_PADRAO.boasVindas, opcoes, d)).toBe(
      "Oi, Maria! 💕 Sou a assistente virtual da Madame Fê. Escolha uma opção digitando o número:\n\n" +
        "1 - Endereço\n2 - Agendar horário",
    );
  });

  it("respostas com endereço/horário reais e link", () => {
    expect(previaRespostaRobo(opcoes[1], "Digite 0", null, d)).toBe(
      "Estamos em Rua A, 1. sáb 09:00 às 13:00\n\nDigite 0",
    );
    expect(previaRespostaRobo(opcoes[0], "", "https://x.com/agendar", d)).toBe(
      "Agende pelo link: https://x.com/agendar",
    );
  });
});
