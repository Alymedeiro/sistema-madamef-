"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  errosDasRespostas,
  type Pergunta,
  type Respostas,
} from "@/lib/dominio/anamnese";
import { mensagemErroBanco } from "@/lib/erros-db";
import { registrarAcesso } from "@/lib/ficha/acesso";
import { decodificarAssinaturaPng } from "@/lib/ficha/assinatura";
import {
  BUCKET_FICHA,
  URL_ASSINADA_SEGUNDOS,
  caminhoArquivo,
} from "@/lib/ficha/caminhos";
import { ERRO_INESPERADO } from "@/lib/resultado";
import { exigirPerfil } from "@/lib/sessao";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { idSchema } from "@/lib/validacao";

type ResultadoId = { ok: true; id: string } | { ok: false; erro: string };
type ResultadoUrl = { ok: true; url: string } | { ok: false; erro: string };

const MODELO_MUDOU = "O modelo de anamnese mudou. Recomece o preenchimento.";
const ERRO_ASSINATURA = "Assine no quadro antes de confirmar.";

const respostasSchema = z.record(
  z.string().max(60),
  z.union([
    z.string().max(2000),
    z.boolean(),
    z.object({ sim: z.boolean(), detalhe: z.string().max(2000).optional() }),
    z.array(z.string().max(200)).max(50),
  ]),
);

const entradaSchema = z.object({
  clienteId: idSchema,
  modeloId: idSchema,
  respostas: respostasSchema,
  assinatura: z.string().max(400_000),
});

export async function registrarAnamnese(dados: {
  clienteId: string;
  modeloId: string;
  respostas: Respostas;
  assinatura: string;
}): Promise<ResultadoId> {
  await exigirPerfil("dona", "recepcao");

  const entrada = entradaSchema.safeParse(dados);
  if (!entrada.success) return { ok: false, erro: ERRO_INESPERADO };
  const { clienteId, modeloId, assinatura } = entrada.data;

  let path: string | null = null;
  const admin = () => createAdminClient();
  try {
    const supabase = await createClient();
    const { data: modelo, error: erroModelo } = await supabase
      .from("modelos_anamnese")
      .select("id, versao, ativo, perguntas")
      .eq("id", modeloId)
      .maybeSingle();
    if (erroModelo) return { ok: false, erro: mensagemErroBanco(erroModelo) };
    if (!modelo || !modelo.ativo) return { ok: false, erro: MODELO_MUDOU };

    // Só ficam as respostas de perguntas que existem nesta versão do modelo.
    const perguntas = modelo.perguntas as unknown as Pergunta[];
    const ids = new Set(perguntas.map((p) => p.id));
    const respostas = Object.fromEntries(
      Object.entries(entrada.data.respostas).filter(([k]) => ids.has(k)),
    ) as Respostas;

    const erros = errosDasRespostas(perguntas, respostas);
    const primeiro = Object.values(erros)[0];
    if (primeiro) return { ok: false, erro: primeiro };

    const png = decodificarAssinaturaPng(assinatura);
    if (!png) return { ok: false, erro: ERRO_ASSINATURA };

    const id = randomUUID();
    path = caminhoArquivo(clienteId, "anamneses", id, "png");
    const { error: erroUpload } = await admin()
      .storage.from(BUCKET_FICHA)
      .upload(path, png, { contentType: "image/png", upsert: false });
    if (erroUpload) {
      path = null;
      return { ok: false, erro: "Não foi possível salvar a assinatura. Tente novamente." };
    }

    const { error } = await supabase.from("anamneses").insert({
      id,
      cliente_id: clienteId,
      modelo_id: modelo.id,
      modelo_versao: modelo.versao,
      respostas,
      assinatura_path: path,
    });
    if (error) {
      await admin().storage.from(BUCKET_FICHA).remove([path]);
      return { ok: false, erro: mensagemErroBanco(error) };
    }
    revalidatePath(`/clientes/${clienteId}`);
    return { ok: true, id };
  } catch {
    if (path) {
      try {
        await admin().storage.from(BUCKET_FICHA).remove([path]);
      } catch {
        // melhor esforço: o arquivo órfão não expõe dado de ninguém.
      }
    }
    return { ok: false, erro: ERRO_INESPERADO };
  }
}

/** URL assinada (5 min) da assinatura; a leitura é auditada antes de entregar. */
export async function urlAssinaturaAnamnese(anamneseId: string): Promise<ResultadoUrl> {
  await exigirPerfil("dona", "recepcao", "profissional");
  if (!idSchema.safeParse(anamneseId).success) {
    return { ok: false, erro: "Anamnese não encontrada." };
  }
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("anamneses")
      .select("id, cliente_id, assinatura_path")
      .eq("id", anamneseId)
      .maybeSingle();
    if (error) return { ok: false, erro: mensagemErroBanco(error) };
    if (!data) return { ok: false, erro: "Anamnese não encontrada." };

    try {
      await registrarAcesso(supabase, {
        entidade: "anamneses",
        entidadeId: data.id,
        clienteId: data.cliente_id,
      });
    } catch {
      return { ok: false, erro: "Não foi possível registrar o acesso. Tente novamente." };
    }

    const { data: url, error: erroUrl } = await supabase.storage
      .from(BUCKET_FICHA)
      .createSignedUrl(data.assinatura_path, URL_ASSINADA_SEGUNDOS);
    if (erroUrl || !url) return { ok: false, erro: ERRO_INESPERADO };
    return { ok: true, url: url.signedUrl };
  } catch {
    return { ok: false, erro: ERRO_INESPERADO };
  }
}
