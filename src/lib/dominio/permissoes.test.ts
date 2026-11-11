import { describe, expect, it } from "vitest";
import {
  dividirMenuInferior,
  ITENS_MENU,
  perfisComAcesso,
  podeAcessar,
  type Perfil,
  type Recurso,
} from "./permissoes";

describe("podeAcessar", () => {
  it("dona acessa tudo", () => {
    for (const item of ITENS_MENU) {
      expect(podeAcessar("dona", item.recurso)).toBe(true);
    }
    expect(podeAcessar("dona", "equipe")).toBe(true);
  });

  it("recepção acessa financeiro mas não equipe nem configurações", () => {
    expect(podeAcessar("recepcao", "financeiro")).toBe(true);
    expect(podeAcessar("recepcao", "equipe")).toBe(false);
    expect(podeAcessar("recepcao", "configuracoes")).toBe(false);
  });

  it("profissional vê agenda e consulta serviços, mas não financeiro", () => {
    expect(podeAcessar("profissional", "financeiro")).toBe(false);
    expect(podeAcessar("profissional", "agenda")).toBe(true);
    expect(podeAcessar("profissional", "servicos")).toBe(true);
  });

  it("todos os perfis acessam o início", () => {
    const perfis: Perfil[] = ["dona", "recepcao", "profissional"];
    for (const p of perfis) expect(podeAcessar(p, "inicio")).toBe(true);
  });

  it("mensagens (WhatsApp): dona e recepção; profissional não vê o menu", () => {
    expect(perfisComAcesso("mensagens")).toEqual(["dona", "recepcao"]);
    expect(podeAcessar("profissional", "mensagens")).toBe(false);
    const item = ITENS_MENU.find((i) => i.recurso === "mensagens");
    expect(item).toEqual({
      recurso: "mensagens",
      rotulo: "Mensagens",
      href: "/mensagens",
      icone: "MessageCircle",
    });
  });

  it("profissional não acessa equipe nem configurações", () => {
    expect(podeAcessar("profissional", "equipe")).toBe(false);
    expect(podeAcessar("profissional", "configuracoes")).toBe(false);
  });
});

describe("ITENS_MENU", () => {
  it("segue a ordem do menu da clínica", () => {
    const ordem: Recurso[] = [
      "inicio",
      "agenda",
      "clientes",
      "mensagens",
      "servicos",
      "produtos",
      "financeiro",
      "equipe",
      "configuracoes",
    ];
    expect(ITENS_MENU.map((i) => i.recurso)).toEqual(ordem);
    expect(ITENS_MENU.map((i) => i.rotulo)).toEqual([
      "Início",
      "Agenda",
      "Clientes",
      "Mensagens",
      "Serviços",
      "Produtos",
      "Financeiro",
      "Equipe",
      "Configurações",
    ]);
  });

  it("Financeiro (ícone Wallet) aponta para /financeiro", () => {
    const item = ITENS_MENU.find((i) => i.recurso === "financeiro");
    expect(item).toEqual({
      recurso: "financeiro",
      rotulo: "Financeiro",
      href: "/financeiro",
      icone: "Wallet",
    });
    expect(ITENS_MENU.some((i) => i.href === "/caixa")).toBe(false);
  });

  it("usa href absoluto por recurso", () => {
    for (const item of ITENS_MENU) {
      expect(item.href).toBe(`/${item.recurso}`);
    }
  });
});

describe("perfisComAcesso", () => {
  it("lista só os perfis que podem acessar o recurso", () => {
    expect(perfisComAcesso("equipe")).toEqual(["dona"]);
    expect(perfisComAcesso("financeiro")).toEqual(["dona", "recepcao"]);
    expect(perfisComAcesso("servicos")).toEqual(["dona", "recepcao", "profissional"]);
  });

  it("devolve uma cópia (não expõe a tabela interna)", () => {
    perfisComAcesso("equipe").push("recepcao");
    expect(perfisComAcesso("equipe")).toEqual(["dona"]);
  });
});

describe("dividirMenuInferior (barra do celular)", () => {
  const menuDe = (perfil: Perfil) => ITENS_MENU.filter((i) => podeAcessar(perfil, i.recurso));
  const recursos = (itens: { recurso: Recurso }[]) => itens.map((i) => i.recurso);

  it("dona (8 itens): Início, Agenda, Clientes, Financeiro + Mais com o resto", () => {
    const r = dividirMenuInferior(menuDe("dona"));
    expect(recursos(r.principais)).toEqual(["inicio", "agenda", "clientes", "financeiro"]);
    expect(recursos(r.mais)).toEqual(["mensagens", "servicos", "produtos", "equipe", "configuracoes"]);
  });

  it("recepção (6 itens): mesmos 4 + Mais com Serviços e Produtos", () => {
    const r = dividirMenuInferior(menuDe("recepcao"));
    expect(recursos(r.principais)).toEqual(["inicio", "agenda", "clientes", "financeiro"]);
    expect(recursos(r.mais)).toEqual(["mensagens", "servicos", "produtos"]);
  });

  it("profissional (5 itens): cabe tudo, sem Mais", () => {
    const r = dividirMenuInferior(menuDe("profissional"));
    expect(recursos(r.principais)).toEqual(["inicio", "agenda", "clientes", "servicos", "produtos"]);
    expect(r.mais).toEqual([]);
  });
});

describe("ficha", () => {
  it("abas por perfil", async () => {
    const { abasDaFicha } = await import("./permissoes");
    expect(abasDaFicha("dona")).toEqual([
      "dados", "anamnese", "termos", "fotos", "evolucoes", "pacotes", "historico",
    ]);
    expect(abasDaFicha("recepcao")).not.toContain("fotos");
    expect(abasDaFicha("profissional")).toContain("fotos");
  });
  it("ações da ficha", async () => {
    const { podeNaFicha } = await import("./permissoes");
    expect(podeNaFicha("profissional", "aplicar_anamnese")).toBe(false);
    expect(podeNaFicha("profissional", "colher_termo")).toBe(true);
    expect(podeNaFicha("recepcao", "adicionar_foto")).toBe(false);
    expect(podeNaFicha("dona", "adicionar_evolucao")).toBe(false);
    expect(podeNaFicha("profissional", "adicionar_evolucao")).toBe(true);
    expect(podeNaFicha("recepcao", "cancelar_pacote")).toBe(false);
    expect(podeNaFicha("recepcao", "exportar")).toBe(false);
    expect(podeNaFicha("recepcao", "vender_pacote")).toBe(true);
    expect(podeNaFicha("profissional", "vender_pacote")).toBe(false);
    expect(podeNaFicha("dona", "ver_acessos")).toBe(true);
  });
});

describe("financeiro (abas)", () => {
  it("dona vê as 6 abas na ordem; recepção só Caixa do dia; profissional nenhuma", async () => {
    const { abasDoFinanceiro, ROTULO_ABA_FINANCEIRO } = await import("./permissoes");
    expect(abasDoFinanceiro("dona")).toEqual([
      "painel",
      "receber",
      "pagar",
      "fluxo",
      "comissoes",
      "caixa",
    ]);
    expect(abasDoFinanceiro("dona").map((a) => ROTULO_ABA_FINANCEIRO[a])).toEqual([
      "Painel",
      "Contas a receber",
      "Contas a pagar",
      "Fluxo de caixa",
      "Comissões",
      "Caixa do dia",
    ]);
    expect(abasDoFinanceiro("recepcao")).toEqual(["caixa"]);
    expect(abasDoFinanceiro("profissional")).toEqual([]);
  });

  it("aba pedida: padrão painel para a dona; recepção sempre caixa", async () => {
    const { abaDoFinanceiro } = await import("./permissoes");
    expect(abaDoFinanceiro("dona", undefined)).toBe("painel");
    expect(abaDoFinanceiro("dona", "pagar")).toBe("pagar");
    expect(abaDoFinanceiro("dona", "caixa")).toBe("caixa");
    expect(abaDoFinanceiro("dona", "xyz")).toBe("painel");
    for (const a of [undefined, "painel", "receber", "pagar", "fluxo", "comissoes", "caixa", "xyz"]) {
      expect(abaDoFinanceiro("recepcao", a)).toBe("caixa");
    }
  });
});

describe("produtos (abas)", () => {
  it("dona vê Produtos e Estoque; recepção e profissional só Produtos", async () => {
    const { abasDeProdutos, ROTULO_ABA_PRODUTOS } = await import("./permissoes");
    expect(abasDeProdutos("dona")).toEqual(["produtos", "estoque"]);
    expect(abasDeProdutos("dona").map((a) => ROTULO_ABA_PRODUTOS[a])).toEqual([
      "Produtos",
      "Estoque",
    ]);
    expect(abasDeProdutos("recepcao")).toEqual(["produtos"]);
    expect(abasDeProdutos("profissional")).toEqual(["produtos"]);
  });

  it("aba pedida: estoque só para a dona", async () => {
    const { abaDeProdutos } = await import("./permissoes");
    expect(abaDeProdutos("dona", "estoque")).toBe("estoque");
    expect(abaDeProdutos("dona", undefined)).toBe("produtos");
    expect(abaDeProdutos("dona", "xyz")).toBe("produtos");
    expect(abaDeProdutos("recepcao", "estoque")).toBe("produtos");
    expect(abaDeProdutos("profissional", "estoque")).toBe("produtos");
  });

  it("recepção não tem comissões", async () => {
    const { abasDoFinanceiro } = await import("./permissoes");
    expect(abasDoFinanceiro("recepcao")).not.toContain("comissoes");
    expect(abasDoFinanceiro("profissional")).not.toContain("comissoes");
  });
});
