import { describe, expect, it } from "vitest";
import { pacoteOferecido, pacoteParaEnvio, type PacoteOriginal } from "./pacote-agendamento";

const C = "cliente-1";
const S = "servico-1";
const P = "pacote-1";
const NOVO_P = "pacote-2";
const disponiveis = [{ id: NOVO_P, restantes: 3, validade: null }];
const original: PacoteOriginal = { pacoteId: P, clienteId: C, servicoId: S, restantes: 2 };

describe("pacoteOferecido", () => {
  it("novo agendamento: o primeiro pacote disponível", () => {
    expect(pacoteOferecido({ original: null, clienteId: C, servicoId: S, disponiveis })).toEqual({
      id: NOVO_P,
      restantes: 3,
    });
    expect(pacoteOferecido({ original: null, clienteId: C, servicoId: S, disponiveis: [] })).toBeNull();
  });

  it("edição sem mudar cliente nem serviço: o pacote já vinculado", () => {
    expect(pacoteOferecido({ original, clienteId: C, servicoId: S, disponiveis })).toEqual({
      id: P,
      restantes: 2,
    });
  });

  it("edição com outra cliente ou outro serviço: o vinculado não vale mais", () => {
    expect(pacoteOferecido({ original, clienteId: "outra", servicoId: S, disponiveis: [] })).toBeNull();
    expect(pacoteOferecido({ original, clienteId: C, servicoId: "outro", disponiveis })).toEqual({
      id: NOVO_P,
      restantes: 3,
    });
  });
});

describe("pacoteParaEnvio", () => {
  const oferecido = { id: NOVO_P, restantes: 3 };

  it("novo: usa o oferecido só se marcado; sem pacote não envia o campo", () => {
    expect(pacoteParaEnvio({ original: null, clienteId: C, servicoId: S, oferecido, usar: true })).toBe(NOVO_P);
    expect(pacoteParaEnvio({ original: null, clienteId: C, servicoId: S, oferecido, usar: false })).toBeUndefined();
    expect(pacoteParaEnvio({ original: null, clienteId: C, servicoId: S, oferecido: null, usar: true })).toBeUndefined();
  });

  it("edição mantendo o pacote: não mexe; 'Não usar pacote' envia null", () => {
    const mantido = { id: P, restantes: 2 };
    expect(pacoteParaEnvio({ original, clienteId: C, servicoId: S, oferecido: mantido, usar: true })).toBeUndefined();
    expect(pacoteParaEnvio({ original, clienteId: C, servicoId: S, oferecido: mantido, usar: false })).toBeNull();
  });

  it("edição trocando cliente ou serviço: pacote antigo é limpo (null) ou trocado pelo novo", () => {
    expect(pacoteParaEnvio({ original, clienteId: "outra", servicoId: S, oferecido: null, usar: true })).toBeNull();
    expect(pacoteParaEnvio({ original, clienteId: C, servicoId: "outro", oferecido, usar: false })).toBeNull();
    expect(pacoteParaEnvio({ original, clienteId: C, servicoId: "outro", oferecido, usar: true })).toBe(NOVO_P);
  });

  it("edição de agendamento sem pacote: vincula o oferecido se marcado; senão não envia", () => {
    const semPacote: PacoteOriginal = { ...original, pacoteId: null, restantes: null };
    expect(pacoteParaEnvio({ original: semPacote, clienteId: C, servicoId: S, oferecido, usar: true })).toBe(NOVO_P);
    expect(pacoteParaEnvio({ original: semPacote, clienteId: C, servicoId: S, oferecido, usar: false })).toBeUndefined();
    expect(pacoteOferecido({ original: semPacote, clienteId: C, servicoId: S, disponiveis })).toEqual(oferecido);
  });
});
