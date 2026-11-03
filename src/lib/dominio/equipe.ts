import type { Perfil } from "./permissoes";

export type MudancaDeAcesso = { perfil?: Perfil; ativo?: boolean };

export type ResultadoAcesso = { ok: true } | { ok: false; erro: string };

/**
 * Impede que a dona se tire do sistema: ela não pode se desativar nem deixar
 * de ser dona. Como quem executa a ação é sempre uma dona ativa, isso garante
 * que sempre exista ao menos uma dona ativa.
 */
export function podeAlterarAcesso(
  sessaoColaboradorId: string,
  alvoId: string,
  mudanca: MudancaDeAcesso,
): ResultadoAcesso {
  if (sessaoColaboradorId !== alvoId) return { ok: true };

  if (mudanca.ativo === false) {
    return { ok: false, erro: "Você não pode desativar o seu próprio acesso." };
  }
  if (mudanca.perfil !== undefined && mudanca.perfil !== "dona") {
    return { ok: false, erro: "Você não pode remover o seu próprio acesso de dona." };
  }
  return { ok: true };
}
