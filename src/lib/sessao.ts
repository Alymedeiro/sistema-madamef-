import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Perfil } from "@/lib/dominio/permissoes";

export type Sessao = {
  userId: string;
  colaborador: { id: string; nome: string; perfil: Perfil };
};

type EstadoSessao =
  | { tipo: "anonima" }
  | { tipo: "inativa" }
  | { tipo: "ativa"; sessao: Sessao; trocaObrigatoria: boolean };

/**
 * Resolve quem está logado. Três resultados:
 * - anônima: sem usuário válido (ou Supabase inalcançável);
 * - inativa: há usuário no Auth, mas nenhum colaborador ATIVO vinculado
 *   (o RLS devolve 0 linhas de `colaboradores` para colaborador desativado);
 * - ativa: colaborador ativo encontrado.
 * Erro de consulta que não seja "sem linhas" é lançado, não vira "inativa":
 * uma falha passageira do banco não pode deslogar ninguém nem causar laço.
 */
const resolverEstado = cache(async (): Promise<EstadoSessao> => {
  const supabase = await createClient();

  let userId: string | null = null;
  let trocaObrigatoria = false;
  try {
    // Validação local do JWT (sem ida ao servidor de auth); o middleware já
    // renovou o token desta requisição.
    const { data, error } = await supabase.auth.getClaims();
    userId = error ? null : (data?.claims?.sub ?? null);
    // Senha provisória dada pela dona (app_metadata, só o servidor grava).
    const app = (data?.claims as { app_metadata?: Record<string, unknown> } | undefined)
      ?.app_metadata;
    trocaObrigatoria = !error && app?.deve_trocar_senha === true;
  } catch {
    userId = null;
  }
  if (!userId) return { tipo: "anonima" };

  const { data, error } = await supabase
    .from("colaboradores")
    .select("id, nome, perfil")
    .eq("usuario_auth_id", userId)
    .eq("ativo", true)
    .maybeSingle();

  if (error) throw new Error(`Falha ao carregar o colaborador: ${error.message}`);
  if (!data) return { tipo: "inativa" };

  return {
    tipo: "ativa",
    sessao: {
      userId,
      colaborador: { id: data.id, nome: data.nome, perfil: data.perfil },
    },
    trocaObrigatoria,
  };
});

/** Sessão do colaborador ativo, ou null (sem login ou colaborador inativo). */
export async function getSessao(): Promise<Sessao | null> {
  const estado = await resolverEstado();
  return estado.tipo === "ativa" ? estado.sessao : null;
}

/**
 * Garante login e perfil. Sem login → /login; colaborador desativado →
 * /login?motivo=inativo; perfil sem permissão → /inicio. Sem `perfis`, basta
 * ser colaborador ativo.
 */
export async function exigirPerfil(...perfis: Perfil[]): Promise<Sessao> {
  const estado = await resolverEstado();
  if (estado.tipo === "anonima") redirect("/login");
  if (estado.tipo === "inativa") redirect("/login?motivo=inativo");
  // Entrou com senha provisória: só passa depois de criar a própria senha.
  if (estado.trocaObrigatoria) redirect("/definir-senha?obrigatoria=1");

  const { sessao } = estado;
  if (perfis.length > 0 && !perfis.includes(sessao.colaborador.perfil)) {
    redirect("/inicio");
  }
  return sessao;
}

/**
 * Para a tela de definir senha: exige colaborador ativo, mas não manda de
 * volta para lá quem tem a troca obrigatória pendente (evita o laço).
 */
export async function exigirSessaoParaSenha(): Promise<Sessao & { trocaObrigatoria: boolean }> {
  const estado = await resolverEstado();
  if (estado.tipo === "anonima") redirect("/login");
  if (estado.tipo === "inativa") redirect("/login?motivo=inativo");
  return { ...estado.sessao, trocaObrigatoria: estado.trocaObrigatoria };
}
