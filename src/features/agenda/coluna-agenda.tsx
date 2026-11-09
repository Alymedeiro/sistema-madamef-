"use client";

import { useDroppable } from "@dnd-kit/core";
import type { Intervalo } from "@/lib/dominio/intervalos";
import { cn } from "@/lib/utils";
import { CartaoAgendamento } from "./cartao-agendamento";
import { COR_STATUS } from "@/lib/dominio/status";
import { horaNoFuso } from "@/lib/dominio/tempo";
import type { AgendamentoAgenda, BloqueioAgenda, PedidoAgenda } from "./dados-agenda";
import {
  distribuirEmFaixas,
  faixasForaDaJornada,
  fimDaGrade,
  idDoHorario,
  linhaDaHora,
  PASSO_MIN,
  posicaoNaGrade,
} from "./grade";

/** Altura de cada linha de 15 min (área de toque ≥ 44 px). */
export const ALTURA_LINHA = 44;

export const HACHURADO: React.CSSProperties = {
  backgroundImage:
    "repeating-linear-gradient(135deg, rgb(61 43 31 / 0.10) 0 6px, transparent 6px 12px)",
};

type Props = {
  profissionalId: string;
  corProfissional: string;
  /** Rótulo usado nos nomes acessíveis dos horários (profissional ou dia). */
  rotulo: string;
  data: string;
  linhas: string[];
  jornadaDoDia: Intervalo[];
  /** Dia sem funcionamento da clínica (só na visão semana). */
  fechado?: boolean;
  agendamentos: AgendamentoAgenda[];
  bloqueios: BloqueioAgenda[];
  pedidos?: PedidoAgenda[];
  podeAgendar: boolean;
  podeArrastar: boolean;
  onNovo: (profissionalId: string, data: string, hora: string) => void;
  onAbrir: (a: AgendamentoAgenda) => void;
  /** Só dona/recepção: abre o pedido na fila. Sem isso o bloco não é tocável. */
  onAbrirPedido?: (id: string) => void;
};

function Horario({
  id,
  rotulo,
  hora,
  podeAgendar,
  onClick,
}: {
  id: string;
  rotulo: string;
  hora: string;
  podeAgendar: boolean;
  onClick: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id, disabled: !podeAgendar });
  const cheia = hora.endsWith(":00");
  const classe = cn(
    "block w-full border-t",
    cheia ? "border-border/60" : "border-dashed border-border/25",
    isOver && "bg-ouro-claro/40",
  );
  if (!podeAgendar) return <div ref={setNodeRef} className={classe} style={{ height: ALTURA_LINHA }} />;
  return (
    <button
      ref={setNodeRef}
      type="button"
      onClick={onClick}
      aria-label={`Agendar ${rotulo} às ${hora}`}
      className={cn(
        classe,
        "text-left text-xs text-transparent outline-none hover:bg-blush hover:text-muted-foreground focus-visible:bg-blush focus-visible:text-muted-foreground focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:ring-inset",
      )}
      style={{ height: ALTURA_LINHA }}
    >
      <span className="px-2">{hora} · livre</span>
    </button>
  );
}

/** Uma coluna da grade: horários livres, trechos fora da jornada, bloqueios e cartões. */
export function ColunaAgenda({
  profissionalId,
  corProfissional,
  rotulo,
  data,
  linhas,
  jornadaDoDia,
  fechado = false,
  agendamentos,
  bloqueios,
  pedidos = [],
  podeAgendar,
  podeArrastar,
  onNovo,
  onAbrir,
  onAbrirPedido,
}: Props) {
  const fim = fimDaGrade(linhas, PASSO_MIN);
  const foraDaJornada = fim && !fechado ? faixasForaDaJornada(jornadaDoDia, linhas[0], fim) : [];
  const faixas = distribuirEmFaixas(
    [...agendamentos, ...pedidos].map((a) => ({
      id: a.id,
      inicio: new Date(a.inicio),
      fim: new Date(a.fim),
    })),
  );

  return (
    <div className="relative" style={{ height: linhas.length * ALTURA_LINHA }}>
      {!fechado &&
        linhas.map((hora) => (
          <Horario
            key={hora}
            id={idDoHorario(profissionalId, data, hora)}
            rotulo={rotulo}
            hora={hora}
            podeAgendar={podeAgendar}
            onClick={() => onNovo(profissionalId, data, hora)}
          />
        ))}

      {fechado && (
        <div
          className="absolute inset-0 flex items-start justify-center pt-4 text-sm text-muted-foreground"
          style={HACHURADO}
        >
          Fechado
        </div>
      )}

      {foraDaJornada.map((f) => (
        <div
          key={f.inicio}
          aria-hidden
          className="pointer-events-none absolute inset-x-0"
          style={{
            ...HACHURADO,
            top: linhaDaHora(f.inicio, linhas[0], PASSO_MIN) * ALTURA_LINHA,
            height: (linhaDaHora(f.fim, linhas[0], PASSO_MIN) - linhaDaHora(f.inicio, linhas[0], PASSO_MIN)) * ALTURA_LINHA,
          }}
        />
      ))}

      {bloqueios.map((b) => {
        const pos = posicaoNaGrade(new Date(b.inicio), new Date(b.fim), data, linhas, PASSO_MIN);
        if (!pos) return null;
        return (
          <div
            key={b.id}
            className="absolute inset-x-0 z-[5] overflow-hidden border-y border-neutral-400 bg-neutral-200 px-2 py-1 text-sm text-neutral-800"
            style={{ top: pos.topo * ALTURA_LINHA, height: pos.altura * ALTURA_LINHA }}
          >
            <span className="font-medium">Bloqueado:</span> {b.motivo}
          </div>
        );
      })}

      {pedidos.map((p) => {
        const pos = posicaoNaGrade(new Date(p.inicio), new Date(p.fim), data, linhas, PASSO_MIN);
        if (!pos) return null;
        const faixa = faixas.get(p.id) ?? { faixa: 0, total: 1 };
        const largura = 100 / faixa.total;
        const titulo = `${p.avaliacao ? "Avaliação" : "Pedido online"} — ${p.primeiroNome}`;
        const classe = cn(
          "absolute z-10 overflow-hidden rounded-md border border-l-4 px-2 py-1 text-left text-sm",
          COR_STATUS.pendente.fundo,
          onAbrirPedido &&
            "min-h-11 cursor-pointer outline-none focus-visible:ring-[3px] focus-visible:ring-ring",
        );
        const estilo = {
          top: pos.topo * ALTURA_LINHA + 1,
          height: pos.altura * ALTURA_LINHA - 2,
          left: `calc(${faixa.faixa * largura}% + 2px)`,
          width: `calc(${largura}% - 4px)`,
          borderLeftColor: corProfissional,
        };
        const conteudo = (
          <>
            <span className="block truncate font-semibold">
              🟡 {horaNoFuso(p.inicio)}–{horaNoFuso(p.fim)}
            </span>
            <span className="block truncate">{titulo}</span>
            <span className="block truncate text-xs">Aguardando resposta</span>
          </>
        );
        return onAbrirPedido ? (
          <button
            key={p.id}
            type="button"
            data-pedido={p.id}
            aria-label={`${horaNoFuso(p.inicio)} ${titulo}, aguardando resposta`}
            onClick={() => onAbrirPedido(p.id)}
            className={classe}
            style={estilo}
          >
            {conteudo}
          </button>
        ) : (
          <div
            key={p.id}
            data-pedido={p.id}
            role="img"
            aria-label={`${horaNoFuso(p.inicio)} ${titulo}, aguardando resposta`}
            className={classe}
            style={estilo}
          >
            {conteudo}
          </div>
        );
      })}

      {agendamentos.map((a) => {
        const pos = posicaoNaGrade(new Date(a.inicio), new Date(a.fim), data, linhas, PASSO_MIN);
        if (!pos) return null;
        const faixa = faixas.get(a.id) ?? { faixa: 0, total: 1 };
        const largura = 100 / faixa.total;
        return (
          <CartaoAgendamento
            key={a.id}
            agendamento={a}
            corProfissional={corProfissional}
            arrastavel={podeArrastar && (a.status === "pendente" || a.status === "confirmado")}
            onAbrir={() => onAbrir(a)}
            estilo={{
              top: pos.topo * ALTURA_LINHA + 1,
              height: pos.altura * ALTURA_LINHA - 2,
              left: `calc(${faixa.faixa * largura}% + 2px)`,
              width: `calc(${largura}% - 4px)`,
            }}
          />
        );
      })}
    </div>
  );
}
