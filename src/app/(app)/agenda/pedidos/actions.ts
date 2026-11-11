"use server";

import { revalidatePath } from "next/cache";
import { aprovarProposta } from "@/app/(app)/agenda/regras";
import { clientesPorTelefone } from "@/features/pedidos/dados";
import { MENSAGEM_VALIDACAO } from "@/lib/dominio/agenda";
import { normalizarTextoBusca } from "@/lib/dominio/clientes";
import { linkWhatsApp, mensagemAprovado, mensagemRecusado, RESERVA_HORAS } from "@/lib/dominio/online";
import { mensagemErroBanco } from "@/lib/erros-db";
import { ERRO_INESPERADO } from "@/lib/resultado";
import { exigirPerfil } from "@/lib/sessao";
import { createClient } from "@/lib/supabase/server";
import { aprovacaoSchema, recusaSchema, type AprovacaoInput, type RecusaInput } from "./schemas";

// Dona e recepção. exigirPerfil redireciona lançando; por isso fica fora dos try/catch.

const JA_RESPONDIDO = "Este pedido já foi respondido.";
const NAO_ENCONTRADO = "Pedido não encontrado.";

const erro = (mensagem: string) => ({ ok: false as const, erro: mensagem });

export type ResultadoAprovacao =
  /** naFila: a resposta automática entrou mesmo na fila do WhatsApp. */
  | { ok: true; agendamentoId: string; mensagem: string; link: string; naFila: boolean }
  /** clienteId: a cliente já ficou cadastrada (ou reaproveitada); repetir com ela. */
  | { ok: false; erro: string; clienteId?: string }
  | { ok: false; aviso: "fora_da_jornada"; erro: string };

export type ResultadoRecusa =
  | { ok: true; mensagem: string; link: string; naFila: boolean }
  | { ok: false; erro: string };

type Supabase = Awaited<ReturnType<typeof createClient>>;

async function carregarPedido(supabase: Supabase, id: string) {
  const { data, error } = await supabase
    .from("pedidos_online")
    .select("id, status, servico_id, nome, whatsapp, aceite_privacidade_em, criado_em, servicos(nome)")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

/** Aguardando e ainda dentro das 24 h de reserva (mesma regra de pedido_vencido). */
function respondivel(p: { status: string; criado_em: string }): boolean {
  return (
    p.status === "aguardando" &&
    new Date(p.criado_em).getTime() > Date.now() - RESERVA_HORAS * 3600_000
  );
}

/**
 * A resposta automática entrou na fila? O gatilho só enfileira com o envio
 * ligado e WhatsApp brasileiro válido, e engole erro: sem a linha, a tela
 * mantém o botão manual. Na dúvida (erro na consulta), também.
 */
async function respostaNaFila(
  supabase: Supabase,
  pedidoId: string,
  tipo: "pedido_aprovado" | "pedido_recusado",
): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from("fila_mensagens")
      .select("id")
      .eq("pedido_online_id", pedidoId)
      .eq("tipo", tipo)
      .limit(1);
    return !error && (data?.length ?? 0) > 0;
  } catch {
    return false;
  }
}

function revalidar() {
  revalidatePath("/agenda", "layout");
  revalidatePath("/inicio");
}

/**
 * Aprova o pedido: valida o horário com as regras da agenda (encaixe fora da
 * jornada pede confirmação), cadastra a cliente nova se preciso (aceite LGPD
 * = aceite do aviso na página) e cria o agendamento pela RPC, que marca o
 * pedido aprovado na mesma transação.
 */
export async function aprovarPedido(dados: AprovacaoInput): Promise<ResultadoAprovacao> {
  await exigirPerfil("dona", "recepcao");

  const parsed = aprovacaoSchema.safeParse(dados);
  if (!parsed.success) return erro(parsed.error.issues[0].message);
  const d = parsed.data;

  try {
    const supabase = await createClient();
    const [pedido, prof] = await Promise.all([
      carregarPedido(supabase, d.pedidoId),
      supabase.from("colaboradores").select("nome").eq("id", d.profissionalId).maybeSingle(),
    ]);
    if (!pedido) return erro(NAO_ENCONTRADO);
    if (!respondivel(pedido)) return erro(JA_RESPONDIDO);
    if (prof.error) return erro(ERRO_INESPERADO);

    const aprovado = await aprovarProposta(supabase, {
      profissionalId: d.profissionalId,
      servicoId: pedido.servico_id,
      data: d.data,
      hora: d.hora,
      forcarForaJornada: d.forcarForaJornada,
    });
    if (!aprovado.ok) {
      return "aviso" in aprovado
        ? { ok: false, aviso: "fora_da_jornada", erro: MENSAGEM_VALIDACAO.fora_da_jornada }
        : aprovado;
    }

    let clienteId = d.clienteId;
    let cadastrada = false;
    if (!clienteId && d.novaCliente) {
      // Reaproveita quem já tem este WhatsApp E o mesmo nome: repetir a
      // aprovação depois de um erro (ou duas recepcionistas ao mesmo tempo) não
      // duplica o cadastro. Mesmo número com outro nome (mãe e filha, número
      // trocado) é outra pessoa: cadastra nova.
      const nome = normalizarTextoBusca(d.novaCliente.nome);
      const existentes = await clientesPorTelefone(supabase, d.novaCliente.whatsapp);
      clienteId = existentes.find((c) => normalizarTextoBusca(c.nome) === nome)?.id ?? null;
      cadastrada = clienteId !== null;
    }
    if (!clienteId && d.novaCliente) {
      const { data, error } = await supabase
        .from("clientes")
        .insert({
          nome: d.novaCliente.nome,
          whatsapp: d.novaCliente.whatsapp,
          aceite_lgpd_em: pedido.aceite_privacidade_em,
        })
        .select("id")
        .single();
      if (error || !data) return erro(error ? mensagemErroBanco(error) : ERRO_INESPERADO);
      clienteId = data.id;
      cadastrada = true;
    }
    if (!clienteId) return erro(ERRO_INESPERADO);

    const { data: agendamentoId, error } = await supabase.rpc("aprovar_pedido_online", {
      p_pedido: d.pedidoId,
      p_cliente: clienteId,
      p_profissional: d.profissionalId,
      p_inicio: aprovado.inicio.toISOString(),
      p_fim: aprovado.fim.toISOString(),
      p_valor_centavos: aprovado.precoCentavos,
    });
    if (error || !agendamentoId) {
      const mensagemErro = error ? mensagemErroBanco(error) : ERRO_INESPERADO;
      return cadastrada ? { ok: false, erro: mensagemErro, clienteId } : erro(mensagemErro);
    }

    revalidar();
    const mensagem = mensagemAprovado({
      nome: pedido.nome ?? d.novaCliente?.nome ?? "",
      servico: pedido.servicos?.nome ?? "",
      profissional: prof.data?.nome ?? "",
      inicio: aprovado.inicio,
    });
    const numero = pedido.whatsapp ?? d.novaCliente?.whatsapp ?? "";
    const naFila = await respostaNaFila(supabase, d.pedidoId, "pedido_aprovado");
    return { ok: true, agendamentoId, mensagem, link: linkWhatsApp(numero, mensagem), naFila };
  } catch {
    return erro(ERRO_INESPERADO);
  }
}

/** Recusa o pedido (motivo opcional, até 200 caracteres) e libera o horário. */
export async function recusarPedido(dados: RecusaInput): Promise<ResultadoRecusa> {
  await exigirPerfil("dona", "recepcao");

  const parsed = recusaSchema.safeParse(dados);
  if (!parsed.success) return erro(parsed.error.issues[0].message);
  const d = parsed.data;

  try {
    const supabase = await createClient();
    const pedido = await carregarPedido(supabase, d.pedidoId);
    if (!pedido) return erro(NAO_ENCONTRADO);

    const { error } = await supabase.rpc("recusar_pedido_online", {
      p_pedido: d.pedidoId,
      p_motivo: d.motivo,
    });
    if (error) return erro(mensagemErroBanco(error));

    revalidar();
    const site = (process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/+$/, "");
    const mensagem = mensagemRecusado({
      nome: pedido.nome ?? "",
      servico: pedido.servicos?.nome ?? "",
      site,
    });
    const naFila = await respostaNaFila(supabase, d.pedidoId, "pedido_recusado");
    return { ok: true, mensagem, link: linkWhatsApp(pedido.whatsapp ?? "", mensagem), naFila };
  } catch {
    return erro(ERRO_INESPERADO);
  }
}

/** Sugestão "É a {nome} (cadastrada)?" pelo WhatsApp do pedido. */
export async function sugerirClientes(whatsapp: string): Promise<{ id: string; nome: string }[]> {
  await exigirPerfil("dona", "recepcao");
  try {
    const supabase = await createClient();
    return await clientesPorTelefone(supabase, whatsapp);
  } catch {
    return [];
  }
}
