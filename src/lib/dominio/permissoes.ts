// Permissões de menu por perfil (espelha a tabela do spec §3; a segurança de
// verdade está no RLS do banco — isto só decide o que mostrar e o que exigir).

export type Perfil = "dona" | "recepcao" | "profissional";

export type Recurso =
  | "inicio"
  | "agenda"
  | "clientes"
  | "mensagens"
  | "crm"
  | "servicos"
  | "produtos"
  | "financeiro"
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
  // WhatsApp (Fase 3B): fila e respostas só para quem atende a cliente.
  mensagens: ["dona", "recepcao"],
  // CRM (Fase 5): retorno, clientes sumidas, leads e aniversariantes.
  crm: ["dona", "recepcao"],
  // Serviços e produtos: dona edita; recepção e profissional consultam.
  servicos: ["dona", "recepcao", "profissional"],
  produtos: ["dona", "recepcao", "profissional"],
  // Recepção só vê a aba Caixa do dia (a página força ?aba=caixa).
  financeiro: ["dona", "recepcao"],
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
  { recurso: "mensagens", rotulo: "Mensagens", href: "/mensagens", icone: "MessageCircle" },
  { recurso: "crm", rotulo: "CRM", href: "/crm", icone: "HeartHandshake" },
  { recurso: "servicos", rotulo: "Serviços", href: "/servicos", icone: "Sparkles" },
  { recurso: "produtos", rotulo: "Produtos", href: "/produtos", icone: "Package" },
  { recurso: "financeiro", rotulo: "Financeiro", href: "/financeiro", icone: "Wallet" },
  { recurso: "equipe", rotulo: "Equipe", href: "/equipe", icone: "UserCog" },
  {
    recurso: "configuracoes",
    rotulo: "Configurações",
    href: "/configuracoes",
    icone: "Settings",
  },
];

/** Itens fixos da barra inferior (os mais usados), nesta ordem. */
const PRINCIPAIS_INFERIOR: readonly Recurso[] = ["inicio", "agenda", "clientes", "financeiro"];
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

// ---------------------------------------------------------------------------
// Ficha clínica (spec §3)
// ---------------------------------------------------------------------------

export type AbaFicha =
  | "dados"
  | "anamnese"
  | "termos"
  | "fotos"
  | "evolucoes"
  | "pacotes"
  | "historico";

export const ROTULO_ABA: Record<AbaFicha, string> = {
  dados: "Dados",
  anamnese: "Anamnese",
  termos: "Termos",
  fotos: "Fotos",
  evolucoes: "Evoluções",
  pacotes: "Pacotes",
  historico: "Histórico",
};

const ORDEM_ABAS: readonly AbaFicha[] = [
  "dados",
  "anamnese",
  "termos",
  "fotos",
  "evolucoes",
  "pacotes",
  "historico",
];

/** Abas visíveis, na ordem; a recepção não vê fotos. */
export function abasDaFicha(perfil: Perfil): AbaFicha[] {
  return ORDEM_ABAS.filter((a) => !(a === "fotos" && perfil === "recepcao"));
}

export type AcaoFicha =
  | "aplicar_anamnese"
  | "colher_termo"
  | "adicionar_foto"
  | "arquivar_foto"
  | "adicionar_evolucao"
  | "vender_pacote"
  | "cancelar_pacote"
  | "exportar"
  | "ver_acessos";

const ACAO_FICHA: Record<AcaoFicha, readonly Perfil[]> = {
  aplicar_anamnese: ["dona", "recepcao"],
  colher_termo: ["dona", "recepcao", "profissional"],
  adicionar_foto: ["dona", "profissional"],
  arquivar_foto: ["dona"],
  adicionar_evolucao: ["profissional"],
  vender_pacote: ["dona", "recepcao"],
  cancelar_pacote: ["dona"],
  exportar: ["dona"],
  ver_acessos: ["dona"],
};

export function podeNaFicha(perfil: Perfil, acao: AcaoFicha): boolean {
  return ACAO_FICHA[acao].includes(perfil);
}

// ---------------------------------------------------------------------------
// Financeiro (spec Fase 4 §3): dona vê tudo; recepção só o Caixa do dia.
// ---------------------------------------------------------------------------

export type AbaFinanceiro = "painel" | "receber" | "pagar" | "fluxo" | "comissoes" | "caixa";

export const ROTULO_ABA_FINANCEIRO: Record<AbaFinanceiro, string> = {
  painel: "Painel",
  receber: "Contas a receber",
  pagar: "Contas a pagar",
  fluxo: "Fluxo de caixa",
  comissoes: "Comissões",
  caixa: "Caixa do dia",
};

const ABAS_FINANCEIRO: Record<Perfil, readonly AbaFinanceiro[]> = {
  dona: ["painel", "receber", "pagar", "fluxo", "comissoes", "caixa"],
  recepcao: ["caixa"],
  profissional: [],
};

export function abasDoFinanceiro(perfil: Perfil): AbaFinanceiro[] {
  return [...ABAS_FINANCEIRO[perfil]];
}

/** Aba a mostrar: a pedida se permitida; senão a primeira (painel / caixa). */
export function abaDoFinanceiro(perfil: Perfil, pedida: string | undefined): AbaFinanceiro {
  const abas = ABAS_FINANCEIRO[perfil];
  return abas.find((a) => a === pedida) ?? abas[0] ?? "caixa";
}

// ---------------------------------------------------------------------------
// Produtos (spec Fase 4B): estoque só para a dona.
// ---------------------------------------------------------------------------

export type AbaProdutos = "produtos" | "estoque";

export const ROTULO_ABA_PRODUTOS: Record<AbaProdutos, string> = {
  produtos: "Produtos",
  estoque: "Estoque",
};

const ABAS_PRODUTOS: Record<Perfil, readonly AbaProdutos[]> = {
  dona: ["produtos", "estoque"],
  recepcao: ["produtos"],
  profissional: ["produtos"],
};

export function abasDeProdutos(perfil: Perfil): AbaProdutos[] {
  return [...ABAS_PRODUTOS[perfil]];
}

/** Aba a mostrar: a pedida se permitida; senão `produtos`. */
export function abaDeProdutos(perfil: Perfil, pedida: string | undefined): AbaProdutos {
  return ABAS_PRODUTOS[perfil].find((a) => a === pedida) ?? "produtos";
}
