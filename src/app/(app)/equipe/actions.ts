"use server";

import { revalidatePath } from "next/cache";
import { mensagemErroBanco } from "@/lib/erros-db";
import { podeAlterarAcesso } from "@/lib/dominio/equipe";
import { ERRO_INESPERADO, falha, OK, type Resultado } from "@/lib/resultado";
import { exigirPerfil } from "@/lib/sessao";
import { urlDoSite } from "@/lib/site";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  bloqueioSchema,
  colaboradorEdicaoSchema,
  colaboradorSchema,
  jornadasSchema,
  servicosDoColaboradorSchema,
  type BloqueioInput,
  type ColaboradorEdicaoInput,
  type ColaboradorInput,
  type JornadaInput,
} from "./schemas";

// Toda ação começa com exigirPerfil('dona'): o layout não roda de novo na
// navegação do cliente, então cada ação e cada página conferem o perfil.
// exigirPerfil redireciona lançando; por isso fica fora dos try/catch.

const ERRO_ID = "Colaborador inválido.";
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function mensagemDeConvite(erro: { code?: string; message?: string }): string {
  const texto = erro.message?.toLowerCase() ?? "";
  if (erro.code === "email_exists" || texto.includes("already been registered")) {
    return "Já existe um colaborador com este e-mail.";
  }
  return ERRO_INESPERADO;
}

export async function convidarColaborador(dados: ColaboradorInput): Promise<Resultado> {
  await exigirPerfil("dona");

  const parsed = colaboradorSchema.safeParse(dados);
  if (!parsed.success) return falha(parsed.error.issues[0].message);
  const { email, nome, funcao, perfil, cor, telefone } = parsed.data;

  try {
    const admin = createAdminClient();
    const redirectTo = `${await urlDoSite()}/login`;
    const { data, error } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo });
    if (error || !data.user) return falha(mensagemDeConvite(error ?? {}));
    const authId = data.user.id;

    const supabase = await createClient();
    const { error: erroInsert } = await supabase.from("colaboradores").insert({
      usuario_auth_id: authId,
      nome,
      funcao,
      perfil,
      cor,
      telefone,
    });
    if (erroInsert) {
      // Sem órfãos: o usuário do Auth recém-criado não pode ficar sem colaborador.
      await admin.auth.admin.deleteUser(authId).catch(() => undefined);
      return falha(mensagemErroBanco(erroInsert));
    }
  } catch {
    return falha(ERRO_INESPERADO);
  }

  revalidatePath("/equipe");
  return OK;
}

export async function atualizarColaborador(
  id: string,
  dados: ColaboradorEdicaoInput,
): Promise<Resultado> {
  const sessao = await exigirPerfil("dona");
  if (!ID.test(id)) return falha(ERRO_ID);

  const parsed = colaboradorEdicaoSchema.safeParse(dados);
  if (!parsed.success) return falha(parsed.error.issues[0].message);

  const guarda = podeAlterarAcesso(sessao.colaborador.id, id, { perfil: parsed.data.perfil });
  if (!guarda.ok) return falha(guarda.erro);

  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("colaboradores")
      .update(parsed.data)
      .eq("id", id)
      .select("id");
    if (error) return falha(mensagemErroBanco(error));
    if (!data?.length) return falha("Colaborador não encontrado.");
  } catch {
    return falha(ERRO_INESPERADO);
  }

  revalidatePath("/equipe");
  revalidatePath(`/equipe/${id}`);
  return OK;
}

const BANIMENTO = "876000h"; // ~100 anos

export async function definirAtivo(id: string, ativo: boolean): Promise<Resultado> {
  const sessao = await exigirPerfil("dona");
  if (!ID.test(id)) return falha(ERRO_ID);

  const guarda = podeAlterarAcesso(sessao.colaborador.id, id, { ativo });
  if (!guarda.ok) return falha(guarda.erro);

  try {
    const supabase = await createClient();
    const { data: alvo, error: erroBusca } = await supabase
      .from("colaboradores")
      .select("id, usuario_auth_id")
      .eq("id", id)
      .maybeSingle();
    if (erroBusca) return falha(mensagemErroBanco(erroBusca));
    if (!alvo) return falha("Colaborador não encontrado.");

    const admin = createAdminClient();
    const banir = async (banido: boolean) => {
      if (!alvo.usuario_auth_id) return null;
      const { error } = await admin.auth.admin.updateUserById(alvo.usuario_auth_id, {
        ban_duration: banido ? BANIMENTO : "none",
      });
      return error;
    };

    if (!ativo) {
      // Desativar: o RLS já corta o acesso na hora ao gravar ativo = false;
      // o banimento impede novos logins.
      const { error } = await supabase.from("colaboradores").update({ ativo: false }).eq("id", id);
      if (error) return falha(mensagemErroBanco(error));
      if (await banir(true)) {
        return falha(
          "O colaborador foi desativado e perdeu o acesso, mas não foi possível bloquear o login. Tente desativar de novo.",
        );
      }
    } else {
      // Reativar: libera o login primeiro; sem ativo = true o RLS ainda barra tudo.
      if (await banir(false)) return falha("Não foi possível liberar o login. Tente novamente.");
      const { error } = await supabase.from("colaboradores").update({ ativo: true }).eq("id", id);
      if (error) return falha(mensagemErroBanco(error));
    }
  } catch {
    return falha(ERRO_INESPERADO);
  }

  revalidatePath("/equipe");
  revalidatePath(`/equipe/${id}`);
  return OK;
}

export async function salvarJornadas(
  colaboradorId: string,
  jornadas: JornadaInput[],
): Promise<Resultado> {
  await exigirPerfil("dona");
  if (!ID.test(colaboradorId)) return falha(ERRO_ID);

  const parsed = jornadasSchema.safeParse(jornadas);
  if (!parsed.success) return falha(parsed.error.issues[0].message);

  try {
    const supabase = await createClient();
    const { data: antigas, error: erroLista } = await supabase
      .from("jornadas")
      .select("id")
      .eq("colaborador_id", colaboradorId);
    if (erroLista) return falha(mensagemErroBanco(erroLista));

    // Insere as novas antes de apagar as antigas: se algo falhar no meio, a
    // jornada anterior continua de pé (não há transação pelo cliente).
    let novasIds: string[] = [];
    if (parsed.data.length > 0) {
      const { data: novas, error: erroInsert } = await supabase
        .from("jornadas")
        .insert(
          parsed.data.map((j) => ({
            colaborador_id: colaboradorId,
            dia_semana: j.diaSemana,
            hora_inicio: j.horaInicio,
            hora_fim: j.horaFim,
          })),
        )
        .select("id");
      if (erroInsert) return falha(mensagemErroBanco(erroInsert));
      novasIds = (novas ?? []).map((n) => n.id);
    }

    const antigasIds = (antigas ?? []).map((a) => a.id);
    if (antigasIds.length > 0) {
      const { error: erroDelete } = await supabase.from("jornadas").delete().in("id", antigasIds);
      if (erroDelete) {
        if (novasIds.length > 0) {
          await supabase.from("jornadas").delete().in("id", novasIds);
        }
        return falha(mensagemErroBanco(erroDelete));
      }
    }
  } catch {
    return falha(ERRO_INESPERADO);
  }

  revalidatePath(`/equipe/${colaboradorId}`);
  return OK;
}

/** `inicio` e `fim` vêm de <input type="datetime-local"> (yyyy-MM-ddTHH:mm, horário de São Paulo). */
export async function adicionarBloqueio(
  colaboradorId: string,
  inicio: BloqueioInput["inicio"],
  fim: BloqueioInput["fim"],
  motivo: BloqueioInput["motivo"],
): Promise<Resultado> {
  await exigirPerfil("dona");
  if (!ID.test(colaboradorId)) return falha(ERRO_ID);

  const parsed = bloqueioSchema.safeParse({ inicio, fim, motivo });
  if (!parsed.success) return falha(parsed.error.issues[0].message);

  try {
    const supabase = await createClient();
    const { error } = await supabase
      .from("bloqueios_agenda")
      .insert({ colaborador_id: colaboradorId, ...parsed.data });
    if (error) return falha(mensagemErroBanco(error));
  } catch {
    return falha(ERRO_INESPERADO);
  }

  revalidatePath(`/equipe/${colaboradorId}`);
  return OK;
}

export async function removerBloqueio(id: string): Promise<Resultado> {
  await exigirPerfil("dona");
  if (!ID.test(id)) return falha("Bloqueio inválido.");

  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("bloqueios_agenda")
      .delete()
      .eq("id", id)
      .select("colaborador_id");
    if (error) return falha(mensagemErroBanco(error));
    const colaboradorId = data?.[0]?.colaborador_id;
    if (colaboradorId) revalidatePath(`/equipe/${colaboradorId}`);
  } catch {
    return falha(ERRO_INESPERADO);
  }
  return OK;
}

export async function salvarServicosDoColaborador(
  colaboradorId: string,
  servicoIds: string[],
): Promise<Resultado> {
  await exigirPerfil("dona");
  if (!ID.test(colaboradorId)) return falha(ERRO_ID);

  const parsed = servicosDoColaboradorSchema.safeParse(servicoIds);
  if (!parsed.success) return falha(parsed.error.issues[0].message);
  const desejados = new Set(parsed.data);

  try {
    const supabase = await createClient();
    const { data: atuais, error: erroLista } = await supabase
      .from("colaborador_servicos")
      .select("id, servico_id")
      .eq("colaborador_id", colaboradorId);
    if (erroLista) return falha(mensagemErroBanco(erroLista));

    const existentes = new Set((atuais ?? []).map((a) => a.servico_id));
    const adicionar = [...desejados].filter((s) => !existentes.has(s));
    const remover = (atuais ?? []).filter((a) => !desejados.has(a.servico_id)).map((a) => a.id);

    if (adicionar.length > 0) {
      const { error } = await supabase
        .from("colaborador_servicos")
        .insert(adicionar.map((servico_id) => ({ colaborador_id: colaboradorId, servico_id })));
      if (error) return falha(mensagemErroBanco(error));
    }
    if (remover.length > 0) {
      const { error } = await supabase.from("colaborador_servicos").delete().in("id", remover);
      if (error) return falha(mensagemErroBanco(error));
    }
  } catch {
    return falha(ERRO_INESPERADO);
  }

  revalidatePath(`/equipe/${colaboradorId}`);
  return OK;
}
