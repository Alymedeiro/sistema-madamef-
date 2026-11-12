"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ModeloReativacao, Sumida } from "@/app/(app)/crm/dados";
import { LIMITE_LOTE_REATIVACAO } from "@/app/(app)/crm/schemas";
import { formatarNoFuso } from "@/lib/dominio/tempo";
import { DialogoReativacao } from "./dialogo-reativacao";

const dia = (iso: string) => formatarNoFuso(iso, "dd/MM/yyyy");

function textoOptin(s: Sumida): string {
  if (s.envio === "sem_whatsapp") return "Sem WhatsApp";
  return s.aceitaMarketing ? "Aceita marketing" : "Sem opt-in";
}

export function ListaSumidas({ itens, modelo }: { itens: Sumida[]; modelo: ModeloReativacao }) {
  const [marcadas, setMarcadas] = useState<Set<string>>(new Set());
  const [dialogo, setDialogo] = useState(false);

  const elegiveis = itens.filter((s) => s.envio === "livre");
  const selecionadas = itens.filter((s) => marcadas.has(s.clienteId));
  const todasMarcadas = elegiveis.length > 0 && elegiveis.every((s) => marcadas.has(s.clienteId));

  function alternar(id: string, valor: boolean) {
    setMarcadas((atual) => {
      const novo = new Set(atual);
      if (valor) {
        if (novo.size >= LIMITE_LOTE_REATIVACAO) return atual;
        novo.add(id);
      }
      else novo.delete(id);
      return novo;
    });
  }

  function marcarTodas(valor: boolean) {
    setMarcadas(
      valor
        ? new Set(elegiveis.slice(0, LIMITE_LOTE_REATIVACAO).map((s) => s.clienteId))
        : new Set(),
    );
  }

  if (itens.length === 0) {
    return <p className="text-sm text-muted-foreground">Nenhuma cliente sumida no momento.</p>;
  }

  const excedeu = elegiveis.length > LIMITE_LOTE_REATIVACAO;
  const noLimite = marcadas.size >= LIMITE_LOTE_REATIVACAO;

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="inline-flex min-h-11 cursor-pointer items-center gap-3 text-sm font-medium">
          <Checkbox
            checked={todasMarcadas}
            disabled={elegiveis.length === 0}
            onCheckedChange={(v) => marcarTodas(v === true)}
            aria-label="Marcar todas"
          />
          Marcar todas
          {excedeu && (
            <span className="text-xs font-normal text-muted-foreground">
              (até {LIMITE_LOTE_REATIVACAO} por envio)
            </span>
          )}
        </label>
        <Button type="button" disabled={selecionadas.length === 0} onClick={() => setDialogo(true)}>
          Enviar reativação ({selecionadas.length})
        </Button>
      </div>

      {noLimite && (
        <p role="status" className="text-sm text-muted-foreground">
          Máximo de {LIMITE_LOTE_REATIVACAO} por envio.
        </p>
      )}

      <div className="hidden rounded-xl border bg-card md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-0" />
              <TableHead>Cliente</TableHead>
              <TableHead>Último atendimento</TableHead>
              <TableHead>Dias sem vir</TableHead>
              <TableHead>Opt-in</TableHead>
              <TableHead>Última reativação</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {itens.map((s) => (
              <TableRow key={s.clienteId} data-testid="linha-sumida">
                <TableCell>
                  <Escolha
                    s={s}
                    marcada={marcadas.has(s.clienteId)}
                    bloqueada={noLimite}
                    onAlternar={alternar}
                  />
                </TableCell>
                <TableCell>
                  <LinkCliente s={s} />
                </TableCell>
                <TableCell className="tabular-nums">{dia(s.ultimoAtendimento)}</TableCell>
                <TableCell className="tabular-nums">{s.diasSemVir}</TableCell>
                <TableCell>{textoOptin(s)}</TableCell>
                <TableCell className="tabular-nums">
                  {s.reativacaoEnviadaEm ? dia(s.reativacaoEnviadaEm) : "—"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <ul className="flex flex-col gap-3 md:hidden">
        {itens.map((s) => (
          <li
            key={s.clienteId}
            data-testid="cartao-sumida"
            className="flex items-start gap-1 rounded-xl border bg-card p-2 pr-4 text-sm shadow-sm"
          >
            <Escolha
                    s={s}
                    marcada={marcadas.has(s.clienteId)}
                    bloqueada={noLimite}
                    onAlternar={alternar}
                  />
            <div className="flex min-w-0 flex-1 flex-col gap-1 py-2">
              <LinkCliente s={s} />
              <span className="text-xs text-muted-foreground tabular-nums">
                {s.diasSemVir} dias sem vir · último atendimento {dia(s.ultimoAtendimento)}
              </span>
              <span className="text-xs text-muted-foreground">
                {textoOptin(s)}
                {s.reativacaoEnviadaEm ? ` · reativação em ${dia(s.reativacaoEnviadaEm)}` : ""}
              </span>
            </div>
          </li>
        ))}
      </ul>

      <DialogoReativacao
        aberto={dialogo}
        onFechar={() => setDialogo(false)}
        onConcluir={() => setMarcadas(new Set())}
        clienteIds={selecionadas.map((s) => s.clienteId)}
        primeiraNome={selecionadas[0]?.nome ?? ""}
        variacoes={modelo.variacoes}
        modeloAtivo={modelo.ativo}
        clinica={modelo.clinica}
      />
    </>
  );
}

function Escolha({
  s,
  marcada,
  bloqueada,
  onAlternar,
}: {
  s: Sumida;
  marcada: boolean;
  /** Seleção cheia: só dá para desmarcar. */
  bloqueada: boolean;
  onAlternar: (id: string, valor: boolean) => void;
}) {
  return (
    <label className="inline-flex size-11 cursor-pointer items-center justify-center">
      <Checkbox
        checked={marcada}
        disabled={s.envio !== "livre" || (bloqueada && !marcada)}
        onCheckedChange={(v) => onAlternar(s.clienteId, v === true)}
        aria-label={`Escolher ${s.nome}`}
      />
    </label>
  );
}

function LinkCliente({ s }: { s: Sumida }) {
  return (
    <Link
      href={`/clientes/${s.clienteId}`}
      className="inline-flex min-h-11 items-center font-medium text-ouro-escuro underline-offset-4 hover:underline"
    >
      {s.nome}
    </Link>
  );
}
