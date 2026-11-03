"use server";

import { revalidatePath } from "next/cache";
import { classificarTermoBusca } from "@/lib/dominio/clientes";
import { perfisComAcesso } from "@/lib/dominio/permissoes";
import { mensagemErroBanco } from "@/lib/erros-db";
import { ERRO_INESPERADO, falha, OK, type Resultado } from "@/lib/resultado";
import { exigirPerfil } from "@/lib/sessao";
import { createClient } from "@/lib/supabase/server";
import { idSchema } from "@/lib/validacao";
import { consultarClientes } from "./consulta";
import {
  clienteAtualizacaoSchema,
  clienteSchema,
  type ClienteAtualizacaoInput,
  type ClienteInput,
} from "./schemas";

// Escritas: dona e recepção (o RLS também barra a profissional). exigirPerfil
// redireciona lançando; por isso fica fora dos try/catch.

const ERRO_CLIENTE = "Cliente inválida.";

type ResultadoCriacao = { ok: true; id: string } | { ok: false; erro: string };

const erroCriacao = (erro: string): ResultadoCriacao => ({ ok: false, erro });

export type ClienteResumo = { id: string; nome: string; whatsapp: string | null };

type DadosCliente = ReturnType<typeof clienteAtualizacaoSchema.parse>;

function linhaCliente(d: DadosCliente) {
  return {
    nome: d.nome,
    cpf: d.cpf,
    whatsapp: d.whatsapp,
    email: d.email,
    data_nascimento: d.dataNascimento,
    endereco: d.endereco,
    origem: d.origem,
    observacoes: d.observacoes,
    aceita_whatsapp_marketing: d.aceitaWhatsappMarketing,
  };
}

export async function criarCliente(
  dados: ClienteInput,
): Promise<ResultadoCriacao> {
  await exigirPerfil("dona", "recepcao");

  const parsed = clienteSchema.safeParse(dados);
  if (!parsed.success) return erroCriacao(parsed.error.issues[0].message);
  const { aceiteLgpd: _aceite, ...resto } = parsed.data;
  void _aceite;

  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("clientes")
      .insert({ ...linhaCliente(resto), aceite_lgpd_em: new Date().toISOString() })
      .select("id")
      .single();
    if (error || !data) return erroCriacao(error ? mensagemErroBanco(error) : ERRO_INESPERADO);

    revalidatePath("/clientes", "layout");
    return { ok: true, id: data.id };
  } catch {
    return erroCriacao(ERRO_INESPERADO);
  }
}

export async function atualizarCliente(
  id: string,
  dados: ClienteAtualizacaoInput,
): Promise<Resultado> {
  await exigirPerfil("dona", "recepcao");
  if (!idSchema.safeParse(id).success) return falha(ERRO_CLIENTE);

  const parsed = clienteAtualizacaoSchema.safeParse(dados);
  if (!parsed.success) return falha(parsed.error.issues[0].message);

  try {
    const supabase = await createClient();
    // Nunca inclui aceite_lgpd_em: o aceite é registrado uma vez, no cadastro.
    const { data, error } = await supabase
      .from("clientes")
      .update(linhaCliente(parsed.data))
      .eq("id", id)
      .select("id");
    if (error) return falha(mensagemErroBanco(error));
    if (!data?.length) return falha("Cliente não encontrada.");
  } catch {
    return falha(ERRO_INESPERADO);
  }

  revalidatePath("/clientes", "layout");
  return OK;
}

export async function definirClienteAtivo(id: string, ativo: boolean): Promise<Resultado> {
  await exigirPerfil("dona", "recepcao");
  if (!idSchema.safeParse(id).success) return falha(ERRO_CLIENTE);

  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("clientes")
      .update({ ativo })
      .eq("id", id)
      .select("id");
    if (error) return falha(mensagemErroBanco(error));
    if (!data?.length) return falha("Cliente não encontrada.");
  } catch {
    return falha(ERRO_INESPERADO);
  }

  revalidatePath("/clientes", "layout");
  return OK;
}

/**
 * Busca de clientes ativas por nome (sem acento) ou por telefone/CPF. Também usada
 * pelo diálogo da agenda. Liberada para os três perfis: o RLS mostra à
 * profissional só as clientes vinculadas a ela. Erro do banco é lançado.
 */
export async function buscarClientes(termo: string): Promise<ClienteResumo[]> {
  await exigirPerfil(...perfisComAcesso("clientes"));
  if (typeof termo !== "string" || classificarTermoBusca(termo).tipo === "vazia") return [];

  const supabase = await createClient();
  const linhas = await consultarClientes(supabase, termo);
  return linhas.map(({ id, nome, whatsapp }) => ({ id, nome, whatsapp }));
}
