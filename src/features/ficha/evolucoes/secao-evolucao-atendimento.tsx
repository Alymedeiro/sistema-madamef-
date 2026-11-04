"use client";

import { useCallback, useEffect, useState } from "react";
import {
  evolucoesDoAtendimento,
  type EvolucaoVista,
} from "@/app/(app)/clientes/ficha/evolucoes";
import { formatarNoFuso } from "@/lib/dominio/tempo";
import { CampoEvolucao, ItemEvolucao } from "./campo-evolucao";

/** "Evolução / observações" do atendimento aberto na agenda; carrega ao abrir. */
export function SecaoEvolucaoAtendimento({
  agendamentoId,
  podeAdicionar,
}: {
  agendamentoId: string;
  podeAdicionar: boolean;
}) {
  const [estado, setEstado] = useState<
    { id: string; evolucoes: EvolucaoVista[] } | { id: string; erro: string } | null
  >(null);

  const carregar = useCallback(async () => {
    const r = await evolucoesDoAtendimento(agendamentoId);
    setEstado(
      r.ok ? { id: agendamentoId, evolucoes: r.evolucoes } : { id: agendamentoId, erro: r.erro },
    );
  }, [agendamentoId]);

  useEffect(() => {
    let ativo = true;
    void evolucoesDoAtendimento(agendamentoId).then((r) => {
      if (ativo) {
        setEstado(
          r.ok ? { id: agendamentoId, evolucoes: r.evolucoes } : { id: agendamentoId, erro: r.erro },
        );
      }
    });
    return () => {
      ativo = false;
    };
  }, [agendamentoId]);

  const atual = estado?.id === agendamentoId ? estado : null;

  return (
    <section aria-label="Evolução / observações" className="flex flex-col gap-3 border-t pt-4">
      <h3 className="text-sm font-medium">Evolução / observações</h3>
      {!atual ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : "erro" in atual ? (
        <p role="alert" className="text-sm text-destructive">
          {atual.erro}
        </p>
      ) : (
        <>
          {atual.evolucoes.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma evolução neste atendimento.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {atual.evolucoes.map((e) => (
                <li key={e.id} className="flex flex-col gap-1 text-sm">
                  <p className="text-xs text-muted-foreground">
                    {formatarNoFuso(e.criadoEm, "dd/MM/yyyy HH:mm")} · {e.profissionalNome}
                  </p>
                  <ItemEvolucao
                    id={e.id}
                    texto={e.texto}
                    editavel={e.editavel}
                    onSalvo={carregar}
                  />
                </li>
              ))}
            </ul>
          )}
          {podeAdicionar ? (
            <CampoEvolucao agendamentoId={agendamentoId} onSalvo={carregar} />
          ) : null}
        </>
      )}
    </section>
  );
}
