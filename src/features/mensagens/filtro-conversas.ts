import type { ResumoConversa } from "@/app/(app)/mensagens/dados";
import { classificarTermoBusca, normalizarTextoBusca } from "@/lib/dominio/clientes";
import {
  ROTULO_STATUS_MENSAGEM,
  ROTULO_TIPO_MENSAGEM,
  type StatusMensagem,
  type TipoMensagem,
} from "@/lib/dominio/whatsapp";

export const ROTULO_LEITURA = {
  nao_lidas: "Não lidas",
  quer_remarcar: "Quer remarcar",
  confirmou: "Confirmou",
} as const;
export type LeituraConversa = keyof typeof ROTULO_LEITURA;

export type FiltroConversas = {
  /** Conversas com ao menos uma mensagem da clínica neste status. */
  status?: StatusMensagem;
  /** Conversas com ao menos uma mensagem da clínica deste tipo. */
  tipo?: TipoMensagem;
  /** Nome (sem acento) ou pedaço do WhatsApp. */
  busca?: string;
  leitura?: LeituraConversa;
};

export function filtrarConversas(
  conversas: ResumoConversa[],
  filtro: FiltroConversas,
): ResumoConversa[] {
  const termo = classificarTermoBusca(filtro.busca ?? "");
  return conversas.filter((c) => {
    // Falhas já reenviadas não contam (mesma regra do selo "Falhou").
    if (filtro.status === "falhou" && !c.falhou) return false;
    if (
      (filtro.status || filtro.tipo) &&
      !c.enviadas.some(
        (e) =>
          (!filtro.status || e.status === filtro.status) && (!filtro.tipo || e.tipo === filtro.tipo),
      )
    ) {
      return false;
    }
    if (filtro.leitura === "nao_lidas" && c.naoLidas === 0) return false;
    if (
      (filtro.leitura === "quer_remarcar" || filtro.leitura === "confirmou") &&
      c.classificacao !== filtro.leitura
    ) {
      return false;
    }
    if (termo.tipo === "nome") {
      return c.nome !== null && normalizarTextoBusca(c.nome).includes(termo.texto);
    }
    if (termo.tipo === "numero") {
      return termo.digitos.some((d) => c.telefone.includes(d));
    }
    return true;
  });
}

const unico = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

function valorDe<T extends string>(
  rotulos: Record<T, string>,
  v: string | undefined,
): T | undefined {
  return v && Object.hasOwn(rotulos, v) ? (v as T) : undefined;
}

/**
 * Filtro a partir da URL. `aba` é ignorada (links antigos da Fila/Respostas) e
 * `classificacao` antigo vira `leitura`.
 */
export function lerFiltro(params: Record<string, string | string[] | undefined>): FiltroConversas {
  const antiga = unico(params.classificacao);
  const leitura =
    valorDe(ROTULO_LEITURA, unico(params.leitura)) ??
    (antiga === "para_ler" ? "nao_lidas" : valorDe(ROTULO_LEITURA, antiga));
  return {
    status: valorDe<StatusMensagem>(ROTULO_STATUS_MENSAGEM, unico(params.status)),
    tipo: valorDe<TipoMensagem>(ROTULO_TIPO_MENSAGEM, unico(params.tipo)),
    busca: (unico(params.busca) ?? "").slice(0, 100),
    leitura,
  };
}
