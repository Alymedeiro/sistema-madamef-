import { classificarTermoBusca, escaparLike } from "@/lib/dominio/clientes";
import type { createClient } from "@/lib/supabase/server";

type Supabase = Awaited<ReturnType<typeof createClient>>;

export const LIMITE_BUSCA = 20;

export type LinhaBusca = {
  id: string;
  nome: string;
  whatsapp: string | null;
  ativo: boolean;
};

/**
 * Consulta de clientes por termo, compartilhada pela action de busca e pela
 * lista. Nome: ilike em `nome_busca` (sem acento). Número: whatsapp/cpf contendo
 * os dígitos (variantes já tratadas pelo classificador; só dígitos, então o
 * filtro `or` não precisa de escape). O RLS restringe a profissional.
 */
export async function consultarClientes(
  supabase: Supabase,
  termo: string,
  opcoes: { incluirInativas?: boolean; listarSeVazio?: boolean } = {},
): Promise<LinhaBusca[]> {
  const busca = classificarTermoBusca(termo);
  if (busca.tipo === "vazia" && !opcoes.listarSeVazio) return [];

  let consulta = supabase.from("clientes").select("id, nome, whatsapp, ativo");
  if (!opcoes.incluirInativas) consulta = consulta.eq("ativo", true);

  if (busca.tipo === "nome") {
    consulta = consulta.ilike("nome_busca", `%${escaparLike(busca.texto)}%`);
  } else if (busca.tipo === "numero") {
    consulta = consulta.or(
      busca.digitos.flatMap((d) => [`whatsapp.like.*${d}*`, `cpf.like.*${d}*`]).join(","),
    );
  }

  const { data, error } = await consulta
    .order("nome", { ascending: true })
    .limit(LIMITE_BUSCA);
  if (error) throw new Error(`Falha ao buscar clientes: ${error.message}`);
  return data ?? [];
}
