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

  it("recepção acessa caixa mas não equipe nem configurações", () => {
    expect(podeAcessar("recepcao", "caixa")).toBe(true);
    expect(podeAcessar("recepcao", "equipe")).toBe(false);
    expect(podeAcessar("recepcao", "configuracoes")).toBe(false);
  });

  it("profissional vê agenda e consulta serviços, mas não caixa", () => {
    expect(podeAcessar("profissional", "caixa")).toBe(false);
    expect(podeAcessar("profissional", "agenda")).toBe(true);
    expect(podeAcessar("profissional", "servicos")).toBe(true);
  });

  it("todos os perfis acessam o início", () => {
    const perfis: Perfil[] = ["dona", "recepcao", "profissional"];
    for (const p of perfis) expect(podeAcessar(p, "inicio")).toBe(true);
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
      "servicos",
      "produtos",
      "caixa",
      "equipe",
      "configuracoes",
    ];
    expect(ITENS_MENU.map((i) => i.recurso)).toEqual(ordem);
    expect(ITENS_MENU.map((i) => i.rotulo)).toEqual([
      "Início",
      "Agenda",
      "Clientes",
      "Serviços",
      "Produtos",
      "Caixa",
      "Equipe",
      "Configurações",
    ]);
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
    expect(perfisComAcesso("caixa")).toEqual(["dona", "recepcao"]);
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

  it("dona (8 itens): Início, Agenda, Clientes, Caixa + Mais com o resto", () => {
    const r = dividirMenuInferior(menuDe("dona"));
    expect(recursos(r.principais)).toEqual(["inicio", "agenda", "clientes", "caixa"]);
    expect(recursos(r.mais)).toEqual(["servicos", "produtos", "equipe", "configuracoes"]);
  });

  it("recepção (6 itens): mesmos 4 + Mais com Serviços e Produtos", () => {
    const r = dividirMenuInferior(menuDe("recepcao"));
    expect(recursos(r.principais)).toEqual(["inicio", "agenda", "clientes", "caixa"]);
    expect(recursos(r.mais)).toEqual(["servicos", "produtos"]);
  });

  it("profissional (5 itens): cabe tudo, sem Mais", () => {
    const r = dividirMenuInferior(menuDe("profissional"));
    expect(recursos(r.principais)).toEqual(["inicio", "agenda", "clientes", "servicos", "produtos"]);
    expect(r.mais).toEqual([]);
  });
});
