// Regras puras do painel do dia (sem acesso a dados).

import { dataNoFuso, formatarNoFuso } from "@/lib/dominio/tempo";

export function saudacaoPorHora(agora: Date): "Bom dia" | "Boa tarde" | "Boa noite" {
  const hora = Number(formatarNoFuso(agora, "H"));
  if (hora < 12) return "Bom dia";
  if (hora < 18) return "Boa tarde";
  return "Boa noite";
}

export function primeiroNome(nome: string): string {
  return nome.trim().split(/\s+/)[0] ?? "";
}

export type ProdutoEstoque = {
  id: string;
  nome: string;
  ativo: boolean;
  estoque_atual: number;
  estoque_minimo: number;
};

/** Produtos ativos com estoque no mínimo ou abaixo; os mais críticos (maior falta) primeiro. */
export function estoqueBaixo<T extends ProdutoEstoque>(produtos: T[]): T[] {
  return produtos
    .filter((p) => p.ativo && p.estoque_atual <= p.estoque_minimo)
    .sort(
      (a, b) =>
        a.estoque_atual - a.estoque_minimo - (b.estoque_atual - b.estoque_minimo) ||
        a.nome.localeCompare(b.nome, "pt-BR"),
    );
}

/** Ordena por início (instantes ISO). */
export function agruparPorHorario<T extends { inicio: string }>(itens: T[]): T[] {
  return [...itens].sort((a, b) => new Date(a.inicio).getTime() - new Date(b.inicio).getTime());
}

/** Soma dias a uma data yyyy-MM-dd (calendário, sem fuso). */
export function somarDias(data: string, dias: number): string {
  const base = Date.UTC(Number(data.slice(0, 4)), Number(data.slice(5, 7)) - 1, Number(data.slice(8, 10)));
  return new Date(base + dias * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Datas de São Paulo: hoje, amanhã, o fim da semana (hoje + 6 dias) e o início
 * da janela de "atendidos sem pagamento" (hoje − 6: os últimos 7 dias).
 */
export function diasDaSemana(agora: Date): {
  hoje: string;
  amanha: string;
  fimSemana: string;
  seteDiasAtras: string;
} {
  const hoje = dataNoFuso(agora);
  return {
    hoje,
    amanha: somarDias(hoje, 1),
    fimSemana: somarDias(hoje, 6),
    seteDiasAtras: somarDias(hoje, -6),
  };
}

export type Cartao<T> = { ok: true; dados: T } | { ok: false };

/** Isola a falha de um cartão do painel: os outros continuam aparecendo. */
export async function carregarCartao<T>(carga: Promise<T>): Promise<Cartao<T>> {
  try {
    return { ok: true, dados: await carga };
  } catch (erro) {
    console.error(erro);
    return { ok: false };
  }
}
