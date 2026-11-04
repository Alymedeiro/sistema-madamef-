import { describe, expect, it } from "vitest";
import { montarDadosAgenda, type LinhasAgenda } from "./dados-agenda";

const linhas: LinhasAgenda = {
  colaboradores: [
    { id: "p-bia", nome: "Bia", cor: "#111111", ativo: true },
    { id: "p-ana", nome: "Ana", cor: "#222222", ativo: true },
    { id: "p-inativa", nome: "Carla", cor: "#333333", ativo: false },
    { id: "p-recepcao", nome: "Dora", cor: "#444444", ativo: true },
    { id: "p-so-inativo", nome: "Eva", cor: "#555555", ativo: true },
  ],
  vinculos: [
    { colaborador_id: "p-bia", servico_id: "s1" },
    { colaborador_id: "p-ana", servico_id: "s1" },
    { colaborador_id: "p-ana", servico_id: "s-off" },
    { colaborador_id: "p-inativa", servico_id: "s1" },
    { colaborador_id: "p-so-inativo", servico_id: "s-off" },
  ],
  servicos: [
    { id: "s1", nome: "Limpeza de pele", duracao_min: 60, preco_centavos: 18000, ativo: true },
    { id: "s-off", nome: "Antigo", duracao_min: 30, preco_centavos: 5000, ativo: false },
  ],
  jornadas: [
    { colaborador_id: "p-ana", dia_semana: 2, hora_inicio: "13:00:00", hora_fim: "18:00:00" },
    { colaborador_id: "p-ana", dia_semana: 2, hora_inicio: "09:00:00", hora_fim: "12:00:00" },
  ],
  bloqueios: [
    { id: "b1", colaborador_id: "p-bia", inicio: "2026-11-03T12:00:00+00:00", fim: "2026-11-03T13:00:00+00:00", motivo: "Curso" },
  ],
  agendamentos: [
    {
      id: "a1",
      profissional_id: "p-ana",
      cliente_id: "c1",
      servico_id: "s-off",
      inicio: "2026-11-03T12:00:00+00:00",
      fim: "2026-11-03T12:30:00+00:00",
      status: "pendente",
      observacoes: null,
      valor_previsto_centavos: 5000,
      clientes: { nome: "Maria" },
    },
    {
      id: "a2",
      profissional_id: "p-bia",
      cliente_id: "c2",
      servico_id: "s1",
      inicio: "2026-11-03T14:00:00+00:00",
      fim: "2026-11-03T15:00:00+00:00",
      status: "confirmado",
      observacoes: "x",
      valor_previsto_centavos: 18000,
      clientes: null,
    },
  ],
  horarioFuncionamento: { "2": [{ inicio: "09:00:00", fim: "19:00:00" }] },
};

describe("montarDadosAgenda", () => {
  it("colunas: ativas com ao menos um serviço ativo, por nome", () => {
    const d = montarDadosAgenda(linhas, { perfil: "recepcao", colaboradorId: "p-recepcao" });
    expect(d.profissionais.map((p) => p.id)).toEqual(["p-ana", "p-bia"]);
    expect(d.profissionais[0].servicoIds).toEqual(["s1"]);
  });

  it("profissional vê só a própria coluna e os próprios dados", () => {
    const d = montarDadosAgenda(linhas, { perfil: "profissional", colaboradorId: "p-bia" });
    expect(d.profissionais.map((p) => p.id)).toEqual(["p-bia"]);
    expect(d.agendamentos.map((a) => a.id)).toEqual(["a2"]);
    expect(d.bloqueios.map((b) => b.id)).toEqual(["b1"]);
  });

  it("normaliza jornadas e horário de funcionamento para HH:mm", () => {
    const d = montarDadosAgenda(linhas, { perfil: "dona", colaboradorId: "x" });
    expect(d.jornadas["p-ana"]["2"]).toEqual([
      { inicio: "09:00", fim: "12:00" },
      { inicio: "13:00", fim: "18:00" },
    ]);
    expect(d.jornadas["p-bia"]["2"]).toEqual([]);
    expect(d.horarioFuncionamento["2"]).toEqual([{ inicio: "09:00", fim: "19:00" }]);
    expect(d.horarioFuncionamento["0"]).toEqual([]);
  });

  it("nomeia cliente e serviço (inclusive serviço já desativado)", () => {
    const d = montarDadosAgenda(linhas, { perfil: "dona", colaboradorId: "x" });
    const a1 = d.agendamentos.find((a) => a.id === "a1");
    expect(a1).toMatchObject({ clienteNome: "Maria", servicoNome: "Antigo", profissionalId: "p-ana" });
    expect(d.agendamentos.find((a) => a.id === "a2")?.clienteNome).toBe("Cliente");
  });
});

describe("montarDadosAgenda — atendidos sem pagamento", () => {
  it("marca semPagamento só nos ids informados pelo banco", () => {
    const d = montarDadosAgenda(
      { ...linhas, semPagamento: ["a2"] },
      { perfil: "recepcao", colaboradorId: "p-recepcao" },
    );
    expect(d.agendamentos.find((a) => a.id === "a2")?.semPagamento).toBe(true);
    expect(d.agendamentos.find((a) => a.id === "a1")?.semPagamento).toBe(false);
  });

  it("sem a lista (profissional), ninguém fica marcado", () => {
    const d = montarDadosAgenda(linhas, { perfil: "profissional", colaboradorId: "p-bia" });
    expect(d.agendamentos.every((a) => a.semPagamento === false)).toBe(true);
  });
});

describe("montarDadosAgenda — quem tem atendimento sempre aparece", () => {
  const comInativa: LinhasAgenda = {
    ...linhas,
    agendamentos: [
      ...linhas.agendamentos,
      {
        id: "a3",
        profissional_id: "p-inativa",
        cliente_id: "c3",
        servico_id: "s1",
        inicio: "2026-11-03T15:00:00+00:00",
        fim: "2026-11-03T16:00:00+00:00",
        status: "confirmado",
        observacoes: null,
        valor_previsto_centavos: 18000,
        clientes: { nome: "Joana" },
      },
      {
        id: "a4",
        profissional_id: "p-recepcao",
        cliente_id: "c4",
        servico_id: "s1",
        inicio: "2026-11-03T15:00:00+00:00",
        fim: "2026-11-03T16:00:00+00:00",
        status: "cancelado",
        observacoes: null,
        valor_previsto_centavos: 18000,
        clientes: { nome: "Lia" },
      },
    ],
  };

  it("inativa com atendimento não cancelado ganha coluna, sem aceitar novos agendamentos", () => {
    const d = montarDadosAgenda(comInativa, { perfil: "recepcao", colaboradorId: "p-recepcao" });
    expect(d.profissionais.map((p) => p.id)).toEqual(["p-ana", "p-bia", "p-inativa"]);
    const inativa = d.profissionais.find((p) => p.id === "p-inativa")!;
    expect(inativa).toMatchObject({ ativa: false, aceitaAgendamento: false });
    expect(d.profissionais.find((p) => p.id === "p-ana")).toMatchObject({ ativa: true, aceitaAgendamento: true });
    expect(d.agendamentos.map((a) => a.id)).toContain("a3");
  });

  it("só agendamento cancelado não cria coluna", () => {
    const d = montarDadosAgenda(comInativa, { perfil: "dona", colaboradorId: "x" });
    expect(d.profissionais.map((p) => p.id)).not.toContain("p-recepcao");
  });

  it("ativa sem serviço ativo, mas com atendimento, aparece sem aceitar novos", () => {
    const d = montarDadosAgenda(
      {
        ...linhas,
        agendamentos: [{ ...linhas.agendamentos[0], id: "a5", profissional_id: "p-so-inativo" }],
      },
      { perfil: "dona", colaboradorId: "x" },
    );
    expect(d.profissionais.find((p) => p.id === "p-so-inativo")).toMatchObject({
      ativa: true,
      aceitaAgendamento: false,
    });
  });
});
