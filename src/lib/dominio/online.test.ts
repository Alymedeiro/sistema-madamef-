import { describe, expect, it } from "vitest";
import {
  diasDisponiveis,
  horariosLivres,
  linkWhatsApp,
  mensagemAprovado,
  mensagemRecusado,
  pedidoSchema,
  RESERVA_HORAS,
  type ContextoOnline,
} from "./online";
import { combinarDataHora, formatarNoFuso } from "./tempo";

const DIA = "2026-11-12"; // quinta-feira
const QUINTA = 4;
const hora = (d: Date) => formatarNoFuso(d, "HH:mm");
const em = (h: string) => combinarDataHora(DIA, h);

function ctx(sobra: Partial<ContextoOnline> = {}): ContextoOnline {
  return {
    agora: combinarDataHora("2026-11-10", "10:00"),
    dia: DIA,
    duracaoMin: 60,
    antecedenciaMinHoras: 2,
    antecedenciaMaxDias: 60,
    profissionais: [
      {
        id: "p-ana",
        nome: "Ana",
        jornadas: [{ diaSemana: QUINTA, horaInicio: "09:00", horaFim: "11:00" }],
        ocupados: [],
      },
    ],
    ...sobra,
  };
}

describe("horariosLivres", () => {
  it("lista a grade de 15 min dentro da jornada", () => {
    const r = horariosLivres(ctx());
    expect(r.map((x) => hora(x.inicio))).toEqual([
      "09:00", "09:15", "09:30", "09:45", "10:00",
    ]);
    expect(r.every((x) => x.profissionalId === "p-ana")).toBe(true);
  });

  it("horário ocupado some (intervalos semiabertos)", () => {
    const c = ctx();
    c.profissionais[0].ocupados = [{ inicio: em("10:00"), fim: em("11:00") }];
    const r = horariosLivres(c).map((x) => hora(x.inicio));
    // 09:00 termina 10:00 e encosta no ocupado: livre. 09:15..09:45 sobrepõem.
    expect(r).toEqual(["09:00"]);
  });

  it("serviço que não cabe no fim da jornada não aparece", () => {
    const r = horariosLivres(ctx({ duracaoMin: 90 })).map((x) => hora(x.inicio));
    expect(r).toEqual(["09:00", "09:15", "09:30"]);
  });

  it("antecedência mínima na virada de dia: 23:00 -> 00:30 bloqueado com 2h", () => {
    const c = ctx({
      agora: combinarDataHora("2026-11-11", "23:00"),
      dia: "2026-11-12",
    });
    c.profissionais[0].jornadas = [{ diaSemana: QUINTA, horaInicio: "00:00", horaFim: "03:00" }];
    const r = horariosLivres({ ...c, duracaoMin: 30 }).map((x) => hora(x.inicio));
    expect(r[0]).toBe("01:00");
    expect(r).not.toContain("00:30");
  });

  it("dia 60 lista, dia 61 não lista nada", () => {
    const agora = combinarDataHora("2026-11-12", "08:00");
    const d60 = diasDisponiveis(agora, 60)[60];
    const jornada = (dia: string) => [
      { diaSemana: new Date(`${dia}T12:00:00Z`).getUTCDay(), horaInicio: "09:00", horaFim: "10:00" },
    ];
    const base = ctx({ agora });
    base.profissionais[0].jornadas = jornada(d60);
    expect(horariosLivres({ ...base, dia: d60 }).length).toBeGreaterThan(0);
    const d61s = new Date(`${d60}T12:00:00Z`);
    d61s.setUTCDate(d61s.getUTCDate() + 1);
    const dia61 = d61s.toISOString().slice(0, 10);
    base.profissionais[0].jornadas = jornada(dia61);
    expect(horariosLivres({ ...base, dia: dia61 })).toEqual([]);
  });

  it("dia passado não lista", () => {
    expect(horariosLivres(ctx({ agora: combinarDataHora("2026-11-13", "08:00") }))).toEqual([]);
  });

  it("qualquer uma escolhe a livre por nome", () => {
    const c = ctx();
    const jorn = [{ diaSemana: QUINTA, horaInicio: "09:00", horaFim: "10:00" }];
    c.profissionais = [
      { id: "p-bia", nome: "Bia", jornadas: jorn, ocupados: [] },
      { id: "p-ana", nome: "Ana", jornadas: jorn, ocupados: [{ inicio: em("09:00"), fim: em("10:00") }] },
    ];
    const r = horariosLivres(c);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ profissionalId: "p-bia" });
    expect(hora(r[0].inicio)).toBe("09:00");
  });

  it("com as duas ocupadas, nada", () => {
    const c = ctx();
    const jorn = [{ diaSemana: QUINTA, horaInicio: "09:00", horaFim: "10:00" }];
    const oc = [{ inicio: em("09:00"), fim: em("10:00") }];
    c.profissionais = [
      { id: "p-bia", nome: "Bia", jornadas: jorn, ocupados: oc },
      { id: "p-ana", nome: "Ana", jornadas: jorn, ocupados: oc },
    ];
    expect(horariosLivres(c)).toEqual([]);
  });

  it("empata nome por id e ordena por horário", () => {
    const c = ctx();
    const jorn = [{ diaSemana: QUINTA, horaInicio: "09:00", horaFim: "10:00" }];
    c.profissionais = [
      { id: "b", nome: "Ana", jornadas: jorn, ocupados: [] },
      { id: "a", nome: "Ana", jornadas: jorn, ocupados: [] },
    ];
    expect(horariosLivres(c)[0].profissionalId).toBe("a");
  });

  it("jornada com dois intervalos 09-12 e 14-18", () => {
    const c = ctx();
    c.profissionais[0].jornadas = [
      { diaSemana: QUINTA, horaInicio: "14:00", horaFim: "18:00" },
      { diaSemana: QUINTA, horaInicio: "09:00", horaFim: "12:00" },
    ];
    const r = horariosLivres(c).map((x) => hora(x.inicio));
    expect(r[0]).toBe("09:00");
    expect(r).toContain("11:00");
    expect(r).not.toContain("11:15");
    expect(r).not.toContain("12:00");
    expect(r).not.toContain("13:00");
    expect(r).toContain("14:00");
    expect(r).toContain("17:00");
    expect(r).not.toContain("17:15");
  });

  it("jornada de outro dia da semana não conta", () => {
    const c = ctx();
    c.profissionais[0].jornadas = [{ diaSemana: 1, horaInicio: "09:00", horaFim: "11:00" }];
    expect(horariosLivres(c)).toEqual([]);
  });
});

describe("diasDisponiveis", () => {
  it("tem max+1 itens e começa hoje em SP mesmo às 23:30 UTC-3", () => {
    const agora = combinarDataHora("2026-11-10", "23:30"); // já é 02:30Z do dia 11
    const dias = diasDisponiveis(agora, 60);
    expect(dias).toHaveLength(61);
    expect(dias[0]).toBe("2026-11-10");
    expect(dias[1]).toBe("2026-11-11");
    expect(dias[60]).toBe("2027-01-09");
  });
});

describe("mensagens e link", () => {
  it("RESERVA_HORAS", () => expect(RESERVA_HORAS).toBe(24));

  it("mensagemAprovado", () => {
    expect(
      mensagemAprovado({
        nome: "Maria Silva",
        servico: "Limpeza de pele",
        profissional: "Ana",
        inicio: new Date("2026-11-12T17:00:00Z"),
      }),
    ).toBe(
      "Oi, Maria! Seu horário de Limpeza de pele com Ana está confirmado para 12/11 às 14:00. Madame Fê Clinic",
    );
  });

  it("mensagemRecusado", () => {
    const m = mensagemRecusado({
      nome: "Maria Silva",
      servico: "Limpeza de pele",
      site: "https://sistema-madamef.vercel.app",
    });
    expect(m).toBe(
      "Oi, Maria! Infelizmente o horário pedido para Limpeza de pele não está disponível. Você pode escolher outro em https://sistema-madamef.vercel.app/agendar ou responder esta mensagem.",
    );
  });

  it("linkWhatsApp", () => {
    expect(linkWhatsApp("5511987654321", "Oi, Maria!")).toBe(
      "https://wa.me/5511987654321?text=Oi%2C%20Maria!",
    );
  });
});

describe("pedidoSchema", () => {
  const base = {
    servicoId: "3f0c8f0e-6a52-4d3a-9c0e-1b2a3c4d5e6f",
    profissionalId: null,
    inicio: "2026-11-12T17:00:00.000Z",
    nome: "Maria Silva",
    whatsapp: "(11) 9 8765-4321",
    aceite: true,
    token: "tok",
  };

  it("aceita e normaliza o WhatsApp", () => {
    const r = pedidoSchema.safeParse(base);
    expect(r.success).toBe(true);
    expect(r.data?.whatsapp).toBe("5511987654321");
  });

  it("aceita 011987654321", () => {
    expect(pedidoSchema.parse({ ...base, whatsapp: "011987654321" }).whatsapp).toBe("5511987654321");
  });

  it("recusa sem DDD com mensagem clara", () => {
    const r = pedidoSchema.safeParse({ ...base, whatsapp: "98765-4321" });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0].message).toBe("Informe um WhatsApp com DDD.");
  });

  it("recusa aceite falso", () => {
    const r = pedidoSchema.safeParse({ ...base, aceite: false });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0].message).toBe("Aceite o aviso de privacidade para continuar.");
  });

  it("recusa nome de uma letra e apara espaços", () => {
    expect(pedidoSchema.safeParse({ ...base, nome: "M" }).success).toBe(false);
    expect(pedidoSchema.parse({ ...base, nome: "  Maria  " }).nome).toBe("Maria");
  });

  it("recusa serviço inválido e início que não é data", () => {
    expect(pedidoSchema.safeParse({ ...base, servicoId: "x" }).success).toBe(false);
    expect(pedidoSchema.safeParse({ ...base, inicio: "ontem" }).success).toBe(false);
  });
});
