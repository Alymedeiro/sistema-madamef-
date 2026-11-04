// Permissões de menu por perfil (espelha a tabela do spec §3; a segurança de
// verdade está no RLS do banco — isto só decide o que mostrar e o que exigir).

export type Perfil = "dona" | "recepcao" | "profissional";

export type Recurso =
  | "inicio"
  | "agenda"
  | "clientes"
  | "servicos"
  | "produtos"
  | "caixa"
  | "equipe"
  | "configuracoes";

export const ROTULO_PERFIL: Record<Perfil, string> = {
  dona: "Dona",
  recepcao: "Recepção",
  profissional: "Profissional",
};

const ACESSO: Record<Recurso, readonly Perfil[]> = {
  inicio: ["dona", "recepcao", "profissional"],
  agenda: ["dona", "recepcao", "profissional"],
  // Profissional só vê clientes vinculadas (filtrado pelo RLS).
  clientes: ["dona", "recepcao", "profissional"],
  // Serviços e produtos: dona edita; recepção e profissional consultam.
  servicos: ["dona", "recepcao", "profissional"],
  produtos: ["dona", "recepcao", "profissional"],
  caixa: ["dona", "recepcao"],
  equipe: ["dona"],
  configuracoes: ["dona"],
};

export function podeAcessar(perfil: Perfil, recurso: Recurso): boolean {
  return ACESSO[recurso].includes(perfil);
}

/** Perfis com acesso ao recurso (para `exigirPerfil(...perfisComAcesso(recurso))`). */
export function perfisComAcesso(recurso: Recurso): Perfil[] {
  return [...ACESSO[recurso]];
}

export type ItemMenu = {
  recurso: Recurso;
  rotulo: string;
  href: string;
  /** Nome de um ícone do lucide-react (mapeado em components/shell/menu.tsx). */
  icone: string;
};

export const ITENS_MENU: ItemMenu[] = [
  { recurso: "inicio", rotulo: "Início", href: "/inicio", icone: "House" },
  { recurso: "agenda", rotulo: "Agenda", href: "/agenda", icone: "CalendarDays" },
  { recurso: "clientes", rotulo: "Clientes", href: "/clientes", icone: "Users" },
  { recurso: "servicos", rotulo: "Serviços", href: "/servicos", icone: "Sparkles" },
  { recurso: "produtos", rotulo: "Produtos", href: "/produtos", icone: "Package" },
  { recurso: "caixa", rotulo: "Caixa", href: "/caixa", icone: "Wallet" },
  { recurso: "equipe", rotulo: "Equipe", href: "/equipe", icone: "UserCog" },
  {
    recurso: "configuracoes",
    rotulo: "Configurações",
    href: "/configuracoes",
    icone: "Settings",
  },
];

/** Itens fixos da barra inferior (os mais usados), nesta ordem. */
const PRINCIPAIS_INFERIOR: readonly Recurso[] = ["inicio", "agenda", "clientes", "caixa"];
/** Até este número de itens, todos cabem na barra de 390 px. */
const MAX_ITENS_INFERIOR = 5;

/**
 * Barra inferior do celular: sem rolagem horizontal. Com até 5 itens mostra
 * todos; com mais, os 4 mais usados e o resto no menu "Mais".
 */
export function dividirMenuInferior(itens: ItemMenu[]): { principais: ItemMenu[]; mais: ItemMenu[] } {
  if (itens.length <= MAX_ITENS_INFERIOR) return { principais: itens, mais: [] };
  const principais = PRINCIPAIS_INFERIOR.flatMap((r) => itens.filter((i) => i.recurso === r));
  return {
    principais,
    mais: itens.filter((i) => !PRINCIPAIS_INFERIOR.includes(i.recurso)),
  };
}
