"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { resumirUserAgent } from "@/lib/dominio/termos";
import { mensagemErroBanco } from "@/lib/erros-db";
import { registrarAcesso } from "@/lib/ficha/acesso";
import { decodificarAssinaturaPng } from "@/lib/ficha/assinatura";
import { BUCKET_FICHA, URL_ASSINADA_SEGUNDOS, caminhoArquivo } from "@/lib/ficha/caminhos";
import { gerarPdfTermo } from "@/lib/ficha/pdf-termo";
import { ERRO_INESPERADO } from "@/lib/resultado";
import { exigirPerfil } from "@/lib/sessao";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { idSchema } from "@/lib/validacao";

type ResultadoId = { ok: true; id: string } | { ok: false; erro: string };
type ResultadoUrl = { ok: true; url: string } | { ok: false; erro: string };

const MODELO_MUDOU = "Este termo foi atualizado. Abra novamente para assinar a versão atual.";

const entradaSchema = z.object({
  clienteId: idSchema,
  modeloTermoId: idSchema,
  agendamentoId: idSchema.nullish(),
  assinatura: z.string().max(400_000),
  dispositivo: z.string().max(2000),
  aceite: z.boolean(),
});

export async function colherAssinaturaTermo(dados: {
  clienteId: string;
  modeloTermoId: string;
  agendamentoId?: string | null;
  assinatura: string;
  dispositivo: string;
  aceite: boolean;
}): Promise<ResultadoId> {
  // Os três perfis colhem; o RLS limita a profissional às clientes vinculadas.
  await exigirPerfil();

  const entrada = entradaSchema.safeParse(dados);
  if (!entrada.success) return { ok: false, erro: ERRO_INESPERADO };
  const { clienteId, modeloTermoId, agendamentoId, assinatura, dispositivo, aceite } = entrada.data;
  if (!aceite) return { ok: false, erro: 'Marque "Li e concordo" para assinar.' };
  const png = decodificarAssinaturaPng(assinatura);
  if (!png) return { ok: false, erro: "Assine no quadro antes de confirmar." };

  const enviados: string[] = [];
  const admin = () => createAdminClient();
  const limpar = async () => {
    if (enviados.length === 0) return;
    try {
      await admin().storage.from(BUCKET_FICHA).remove(enviados);
    } catch {
      // melhor esforço: arquivo órfão não expõe dado de ninguém.
    }
  };

  try {
    const supabase = await createClient();
    const { data: cliente, error: erroCliente } = await supabase
      .from("clientes")
      .select("id, nome, cpf")
      .eq("id", clienteId)
      .maybeSingle();
    if (erroCliente) return { ok: false, erro: mensagemErroBanco(erroCliente) };
    if (!cliente) return { ok: false, erro: "Cliente não encontrada." };

    const { data: modelo, error: erroModelo } = await supabase
      .from("modelos_termo")
      .select("id, titulo, texto, versao, ativo")
      .eq("id", modeloTermoId)
      .maybeSingle();
    if (erroModelo) return { ok: false, erro: mensagemErroBanco(erroModelo) };
    if (!modelo || !modelo.ativo) return { ok: false, erro: MODELO_MUDOU };

    if (agendamentoId) {
      const { data: ag, error: erroAg } = await supabase
        .from("agendamentos")
        .select("id")
        .eq("id", agendamentoId)
        .eq("cliente_id", clienteId)
        .maybeSingle();
      if (erroAg) return { ok: false, erro: mensagemErroBanco(erroAg) };
      if (!ag) return { ok: false, erro: "Atendimento não encontrado." };
    }

    const id = randomUUID();
    const assinadoEm = new Date();
    const resumo = resumirUserAgent(dispositivo);
    const { pdf, hashSha256 } = await gerarPdfTermo({
      identificador: id,
      titulo: modelo.titulo,
      versao: modelo.versao,
      texto: modelo.texto,
      clienteNome: cliente.nome,
      clienteCpf: cliente.cpf,
      assinadoEm,
      dispositivo: resumo,
      assinaturaPng: png,
    });

    const caminhoPng = caminhoArquivo(clienteId, "termos", randomUUID(), "png");
    const caminhoPdf = caminhoArquivo(clienteId, "termos", id, "pdf");
    const arquivos = [
      { caminho: caminhoPng, corpo: png, tipo: "image/png" },
      { caminho: caminhoPdf, corpo: pdf, tipo: "application/pdf" },
    ];
    for (const a of arquivos) {
      // Entra na lista antes do envio: um upload que falhou pela metade também é limpo.
      enviados.push(a.caminho);
      const { error } = await admin()
        .storage.from(BUCKET_FICHA)
        .upload(a.caminho, a.corpo, { contentType: a.tipo, upsert: false });
      if (error) {
        await limpar();
        return { ok: false, erro: "Não foi possível salvar o termo. Tente novamente." };
      }
    }

    const { error } = await supabase.from("termos_assinados").insert({
      id,
      cliente_id: clienteId,
      modelo_termo_id: modelo.id,
      modelo_versao: modelo.versao,
      agendamento_id: agendamentoId ?? null,
      assinatura_path: caminhoPng,
      pdf_path: caminhoPdf,
      hash_sha256: hashSha256,
      assinado_em: assinadoEm.toISOString(),
      dispositivo: resumo,
    });
    if (error) {
      await limpar();
      return { ok: false, erro: mensagemErroBanco(error) };
    }
    revalidatePath(`/clientes/${clienteId}`);
    revalidatePath("/agenda");
    return { ok: true, id };
  } catch {
    await limpar();
    return { ok: false, erro: ERRO_INESPERADO };
  }
}

/** URL assinada (5 min) do PDF ou da assinatura; a leitura é auditada antes de entregar. */
export async function urlArquivoTermo(
  termoId: string,
  arquivo: "pdf" | "assinatura",
): Promise<ResultadoUrl> {
  await exigirPerfil("dona", "recepcao", "profissional");
  if (!idSchema.safeParse(termoId).success) return { ok: false, erro: "Termo não encontrado." };
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("termos_assinados")
      .select("id, cliente_id, pdf_path, assinatura_path")
      .eq("id", termoId)
      .maybeSingle();
    if (error) return { ok: false, erro: mensagemErroBanco(error) };
    if (!data) return { ok: false, erro: "Termo não encontrado." };

    try {
      await registrarAcesso(supabase, {
        entidade: "termos_assinados",
        entidadeId: data.id,
        clienteId: data.cliente_id,
      });
    } catch {
      return { ok: false, erro: "Não foi possível registrar o acesso. Tente novamente." };
    }

    const { data: url, error: erroUrl } = await supabase.storage
      .from(BUCKET_FICHA)
      .createSignedUrl(
        arquivo === "pdf" ? data.pdf_path : data.assinatura_path,
        URL_ASSINADA_SEGUNDOS,
      );
    if (erroUrl || !url) return { ok: false, erro: ERRO_INESPERADO };
    return { ok: true, url: url.signedUrl };
  } catch {
    return { ok: false, erro: ERRO_INESPERADO };
  }
}
