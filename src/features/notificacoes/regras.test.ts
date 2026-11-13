import { describe, expect, it } from "vitest";
import {
  criarLimitadorSom,
  decidirAvisos,
  ehRecente,
  linkSeguro,
  mesclarNotificacoes,
  normalizarPreferencias,
  planoSom,
  quandoNotificacao,
  PREFERENCIAS_PADRAO,
  TIPOS_NOTIFICACAO,
  tipoPermitido,
  tiposDoPerfil,
  type Notificacao,
} from "./regras";

const n = (id: string, criada_em: string, extra: Partial<Notificacao> = {}): Notificacao => ({
  id,
  tipo: "mensagem_recebida",
  titulo: `t${id}`,
  corpo: null,
  link: "/mensagens",
  criada_em,
  lida_em: null,
  ...extra,
});

describe("criarLimitadorSom (no máximo 1 som a cada 4 s)", () => {
  it("agrupa os sons dentro da janela", () => {
    const pode = criarLimitadorSom();
    expect(pode(1_000)).toBe(true);
    expect(pode(2_000)).toBe(false);
    expect(pode(4_999)).toBe(false);
    expect(pode(5_000)).toBe(true);
    expect(pode(8_999)).toBe(false);
    expect(pode(20_000)).toBe(true);
  });

  it("intervalo configurável e limitadores independentes", () => {
    const a = criarLimitadorSom(100);
    const b = criarLimitadorSom(100);
    expect(a(0)).toBe(true);
    expect(b(50)).toBe(true);
    expect(a(99)).toBe(false);
    expect(a(100)).toBe(true);
  });
});

describe("preferências", () => {
  it("padrão: som ligado, volume 40, computador ligado, todos os tipos", () => {
    expect(PREFERENCIAS_PADRAO).toEqual({
      som: true,
      volume: 40,
      desktop: true,
      tipos: [...TIPOS_NOTIFICACAO],
    });
  });

  it("filtra por tipo", () => {
    const prefs = { ...PREFERENCIAS_PADRAO, tipos: ["confirmou" as const] };
    expect(tipoPermitido(prefs, "confirmou")).toBe(true);
    expect(tipoPermitido(prefs, "mensagem_recebida")).toBe(false);
    expect(tipoPermitido(PREFERENCIAS_PADRAO, "mensagem_falhou")).toBe(true);
  });

  it("normaliza a linha do banco (ausente → padrão; tipos desconhecidos fora; volume limitado)", () => {
    expect(normalizarPreferencias(null)).toEqual(PREFERENCIAS_PADRAO);
    expect(
      normalizarPreferencias({ som: false, volume: 300, desktop: false, tipos: ["confirmou", "xyz"] }),
    ).toEqual({ som: false, volume: 100, desktop: false, tipos: ["confirmou"] });
  });
});

describe("decidirAvisos (toast × notificação do computador)", () => {
  const base = { tipo: "confirmou" as const, prefs: PREFERENCIAS_PADRAO };

  it("tela visível: toast e som, sem notificação do computador", () => {
    expect(decidirAvisos({ ...base, visivel: true, permissao: "granted" })).toEqual({
      toast: true,
      som: true,
      desktop: false,
    });
  });

  it("tela escondida com permissão: notificação do computador e som", () => {
    expect(decidirAvisos({ ...base, visivel: false, permissao: "granted" })).toEqual({
      toast: false,
      som: true,
      desktop: true,
    });
  });

  it("tela escondida sem permissão ou com o computador desligado: toast", () => {
    for (const permissao of ["default", "denied", "indisponivel"] as const) {
      expect(decidirAvisos({ ...base, visivel: false, permissao })).toMatchObject({
        toast: true,
        desktop: false,
      });
    }
    expect(
      decidirAvisos({
        ...base,
        prefs: { ...PREFERENCIAS_PADRAO, desktop: false },
        visivel: false,
        permissao: "granted",
      }),
    ).toMatchObject({ toast: true, desktop: false });
  });

  it("tipo desligado: nada; som desligado ou volume 0: sem som", () => {
    expect(
      decidirAvisos({
        ...base,
        prefs: { ...PREFERENCIAS_PADRAO, tipos: [] },
        visivel: true,
        permissao: "granted",
      }),
    ).toEqual({ toast: false, som: false, desktop: false });
    expect(
      decidirAvisos({ ...base, prefs: { ...PREFERENCIAS_PADRAO, som: false }, visivel: true, permissao: "granted" })
        .som,
    ).toBe(false);
    expect(
      decidirAvisos({ ...base, prefs: { ...PREFERENCIAS_PADRAO, volume: 0 }, visivel: true, permissao: "granted" })
        .som,
    ).toBe(false);
  });
});

describe("linkSeguro (montagem do link)", () => {
  it.each([
    ["/mensagens?conversa=abc", "/mensagens?conversa=abc"],
    ["/agenda?data=2030-11-14", "/agenda?data=2030-11-14"],
    ["//evil.com", "/inicio"],
    ["/\\evil.com", "/inicio"],
    ["https://evil.com", "/inicio"],
    ["javascript:alert(1)", "/inicio"],
    ["", "/inicio"],
    [null, "/inicio"],
  ])("%s → %s", (link, esperado) => expect(linkSeguro(link)).toBe(esperado));
});

describe("ehRecente (toast só para as dos últimos 60 s ao reconectar)", () => {
  const agora = Date.parse("2030-11-14T18:00:00Z");
  it("dentro e fora da janela", () => {
    expect(ehRecente("2030-11-14T17:59:01Z", agora)).toBe(true);
    expect(ehRecente("2030-11-14T17:58:59Z", agora)).toBe(false);
    expect(ehRecente("inválida", agora)).toBe(false);
  });
});

describe("mesclarNotificacoes", () => {
  it("sem duplicar, mais novas primeiro, com limite", () => {
    const atual = [n("2", "2030-01-01T00:00:02Z"), n("1", "2030-01-01T00:00:01Z")];
    const novas = [n("3", "2030-01-01T00:00:03Z"), n("2", "2030-01-01T00:00:02Z", { titulo: "x" })];
    expect(mesclarNotificacoes(atual, novas).map((x) => x.id)).toEqual(["3", "2", "1"]);
    expect(mesclarNotificacoes(atual, novas, 2).map((x) => x.id)).toEqual(["3", "2"]);
  });
});

describe("planoSom (dois tons suaves)", () => {
  it("660 Hz e 880 Hz, 180 ms cada, ataque 20 ms, ganho = volume/100 × 0,15", () => {
    const p = planoSom(40);
    expect(p.tons).toEqual([
      { frequencia: 660, inicio: 0, duracao: 0.18 },
      { frequencia: 880, inicio: 0.18, duracao: 0.18 },
    ]);
    expect(p.ataque).toBe(0.02);
    expect(p.ganho).toBeCloseTo(0.06);
    expect(planoSom(250).ganho).toBeCloseTo(0.15);
    expect(planoSom(-5).ganho).toBe(0);
  });
});

describe("quandoNotificacao", () => {
  const agora = Date.parse("2030-11-14T18:00:00Z");
  it.each([
    ["2030-11-14T17:59:40Z", "agora"],
    ["2030-11-14T17:55:00Z", "há 5 min"],
    ["2030-11-14T15:00:00Z", "há 3 h"],
    ["2030-11-13T18:00:00Z", "13/11 às 15:00"],
    ["x", ""],
  ])("%s → %s", (c, e) => expect(quandoNotificacao(c, agora)).toBe(e));
});

describe("tiposDoPerfil (preferências mostram só o que o perfil recebe)", () => {
  it("profissional: só os do próprio agendamento", () => {
    expect(tiposDoPerfil("profissional")).toEqual(["confirmou", "quer_remarcar", "agenda_profissional"]);
  });
  it("recepção: os da equipe, sem a agenda da profissional", () => {
    expect(tiposDoPerfil("recepcao")).not.toContain("agenda_profissional");
    expect(tiposDoPerfil("recepcao")).toContain("mensagem_falhou");
  });
  it("dona: todos", () => {
    expect(tiposDoPerfil("dona")).toEqual([...TIPOS_NOTIFICACAO]);
  });
});
