"use server";

import { headers } from "next/headers";
import { z } from "zod";
import { pedidoSchema } from "@/lib/dominio/online";
import { mensagemErroBanco } from "@/lib/erros-db";
import { ipHash } from "@/lib/online/ip";
import { verificarTurnstile } from "@/lib/online/turnstile";
import { createAdminClient } from "@/lib/supabase/admin";

// Ações públicas (sem login): tudo passa pelo service role, que só pode chamar
// as RPCs do agendamento online. Nada de agenda além de horários livres sai daqui.

type Falha = { ok: false; erro: string };

const buscaSchema = z.object({
  servicoId: z.uuid("Registro inválido."),
  profissionalId: z.uuid("Registro inválido.").nullable(),
  dia: z.iso.date("Data inválida."),
});

export async function buscarHorarios(e: {
  servicoId: string;
  profissionalId: string | null;
  dia: string;
}): Promise<{ ok: true; horarios: { inicio: string }[] } | Falha> {
  const parsed = buscaSchema.safeParse(e);
  if (!parsed.success) return { ok: false, erro: parsed.error.issues[0].message };
  const { servicoId, profissionalId, dia } = parsed.data;

  const { data, error } = await createAdminClient().rpc("horarios_livres_online", {
    p_servico: servicoId,
    p_profissional: profissionalId,
    p_dia: dia,
  });
  if (error) return { ok: false, erro: mensagemErroBanco(error) };
  // Só o instante: qual profissional está livre não vai para o navegador.
  return { ok: true, horarios: (data ?? []).map((h) => ({ inicio: h.inicio })) };
}

const ERRO_ROBO = "Não foi possível confirmar que você não é um robô.";

function primeiroNome(nome: string | null | undefined): string {
  return nome?.trim().split(/\s+/)[0] ?? "";
}

/** Primeiro texto não vazio (até 80 caracteres); nenhum → "—". */
function exibir(...textos: (string | null | undefined)[]): string {
  return textos.map((t) => t?.trim().slice(0, 80)).find(Boolean) ?? "—";
}

/**
 * Nomes que o formulário já mostra, só para o resumo quando a leitura de volta
 * falha. Nunca vão ao banco nem decidem nada.
 */
type NomesExibidos = { servicoNome?: string; profissionalNome?: string };

export async function enviarPedido(
  e: z.input<typeof pedidoSchema> & NomesExibidos,
): Promise<
  { ok: true; resumo: { servico: string; profissional: string; inicio: string } } | Falha
> {
  const parsed = pedidoSchema.safeParse(e);
  if (!parsed.success) return { ok: false, erro: parsed.error.issues[0].message };
  const p = parsed.data;

  const cabecalhos = await headers();
  const ip = cabecalhos.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
  if (!(await verificarTurnstile(p.token, ip))) return { ok: false, erro: ERRO_ROBO };

  const admin = createAdminClient();
  const { data: id, error } = await admin.rpc("criar_pedido_online", {
    p_servico: p.servicoId,
    p_profissional: p.profissionalId,
    p_inicio: p.inicio,
    p_nome: p.nome,
    p_whatsapp: p.whatsapp,
    p_ip_hash: ipHash(cabecalhos),
  });
  if (error) return { ok: false, erro: mensagemErroBanco(error) };

  // "Qualquer uma": a profissional é escolhida pelo banco; lê de volta para o resumo.
  const { data: criado } = await admin
    .from("pedidos_online")
    .select(
      "inicio, avaliacao, servicos(nome), profissional:colaboradores!pedidos_online_profissional_id_fkey(nome)",
    )
    .eq("id", id)
    .maybeSingle();

  // Leitura de volta falhou: resumo com o que o formulário mostrou, ou "—".
  const nomeServico = criado?.servicos?.nome;
  return {
    ok: true,
    resumo: {
      servico: exibir(
        nomeServico && (criado?.avaliacao ? `Avaliação de ${nomeServico}` : nomeServico),
        e.servicoNome,
      ),
      profissional: exibir(primeiroNome(criado?.profissional?.nome), e.profissionalNome),
      inicio: criado?.inicio ?? p.inicio,
    },
  };
}
