"use client";

import Link from "next/link";
import { useState } from "react";
import { Lock } from "lucide-react";
import { combinarDataHora, dataNoFuso, formatarNoFuso, horaNoFuso } from "@/lib/dominio/tempo";
import { cn } from "@/lib/utils";
import type { AgendamentoAgenda, DadosAgenda } from "./dados-agenda";
import { hrefAgenda } from "./grade";

const SEMANA = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
/** Linhas por dia no computador; o resto vira "+N". */
const MAX_LINHAS = 3;

const primeiroNome = (nome: string) => nome.trim().split(/\s+/)[0] ?? nome;

/**
 * Visão mês: calendário seg–dom. Cada dia mostra os primeiros horários (cor da
 * profissional) e "+N"; no celular, só a quantidade. Clicar abre o dia.
 */
export function GradeMes({
  dados,
  agendamentos,
  datas,
  mes,
}: {
  dados: DadosAgenda;
  agendamentos: AgendamentoAgenda[];
  datas: string[];
  /** "yyyy-MM" do mês exibido. */
  mes: string;
}) {
  const [filtro, setFiltro] = useState<string | null>(null);
  const hoje = dataNoFuso(new Date());
  const cor = new Map(dados.profissionais.map((p) => [p.id, p.cor]));

  const visiveis = agendamentos
    .filter((a) => a.status !== "cancelado" && (!filtro || a.profissionalId === filtro))
    .sort((a, b) => new Date(a.inicio).getTime() - new Date(b.inicio).getTime());
  const porDia = new Map<string, AgendamentoAgenda[]>();
  for (const a of visiveis) {
    const d = dataNoFuso(a.inicio);
    porDia.set(d, [...(porDia.get(d) ?? []), a]);
  }
  const bloqueiosPorDia = new Map<string, number>();
  for (const b of dados.bloqueios) {
    if (filtro && b.profissionalId !== filtro) continue;
    // Marca cada dia que o bloqueio toca.
    for (const d of datas) {
      const ini = combinarDataHora(d, "00:00").getTime();
      const fim = ini + 24 * 3600_000;
      if (new Date(b.inicio).getTime() < fim && new Date(b.fim).getTime() > ini) {
        bloqueiosPorDia.set(d, (bloqueiosPorDia.get(d) ?? 0) + 1);
      }
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {dados.profissionais.length > 1 && (
        <div role="group" aria-label="Filtrar profissional" className="flex gap-1 overflow-x-auto rounded-lg bg-muted p-1">
          {[{ id: null as string | null, nome: "Todas", cor: null as string | null }, ...dados.profissionais].map((p) => (
            <button
              key={p.id ?? "todas"}
              type="button"
              aria-pressed={filtro === p.id}
              onClick={() => setFiltro(p.id)}
              className={cn(
                "inline-flex min-h-11 shrink-0 items-center gap-2 rounded-md px-3 text-sm font-medium outline-none focus-visible:ring-[3px] focus-visible:ring-ring",
                filtro === p.id ? "bg-card shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {p.cor && <span aria-hidden className="size-3 rounded-full border" style={{ backgroundColor: p.cor }} />}
              {p.nome}
            </button>
          ))}
        </div>
      )}

      <div className="overflow-hidden rounded-xl border bg-card">
        <div className="grid grid-cols-7 border-b bg-muted/50 text-center text-xs font-medium text-muted-foreground">
          {SEMANA.map((d) => (
            <div key={d} className="py-2">
              {d}
            </div>
          ))}
        </div>
        <ol className="grid grid-cols-7">
          {datas.map((d) => {
            const itens = porDia.get(d) ?? [];
            const bloqueios = bloqueiosPorDia.get(d) ?? 0;
            const foraDoMes = !d.startsWith(mes);
            const rotulo = formatarNoFuso(combinarDataHora(d, "12:00"), "EEEE, d 'de' MMMM");
            return (
              <li key={d} className="min-w-0 border-b border-r [&:nth-child(7n)]:border-r-0">
                <Link
                  href={hrefAgenda({ data: d, visao: "dia" })}
                  aria-label={`${rotulo}: ${itens.length} atendimento${itens.length === 1 ? "" : "s"}${bloqueios ? ", com bloqueio" : ""}`}
                  className={cn(
                    "flex h-full min-h-20 flex-col gap-1 p-1.5 text-left outline-none hover:bg-accent/50 focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring sm:min-h-28",
                    foraDoMes && "bg-muted/40 text-muted-foreground",
                  )}
                >
                  <span className="flex items-center justify-between gap-1">
                    <span
                      className={cn(
                        "inline-flex size-7 items-center justify-center rounded-full text-sm tabular-nums",
                        d === hoje && "bg-ouro-escuro font-semibold text-white",
                      )}
                    >
                      {Number(d.slice(8))}
                    </span>
                    {bloqueios > 0 && <Lock aria-hidden className="size-3.5 text-muted-foreground" />}
                  </span>
                  {itens.length > 0 && (
                    <>
                      {/* Celular: só a quantidade. */}
                      <span className="self-start rounded-full bg-blush px-2 text-xs font-medium text-ouro-escuro sm:hidden">
                        {itens.length}
                      </span>
                      <span className="hidden flex-col gap-0.5 sm:flex">
                        {itens.slice(0, MAX_LINHAS).map((a) => (
                          <span key={a.id} className="flex min-w-0 items-center gap-1 text-xs">
                            <span
                              aria-hidden
                              className="size-2 shrink-0 rounded-full"
                              style={{ backgroundColor: cor.get(a.profissionalId) ?? "#986818" }}
                            />
                            <span className="tabular-nums">{horaNoFuso(a.inicio)}</span>
                            <span className="truncate">{primeiroNome(a.clienteNome)}</span>
                          </span>
                        ))}
                        {itens.length > MAX_LINHAS && (
                          <span className="text-xs font-medium text-ouro-escuro">
                            +{itens.length - MAX_LINHAS}
                          </span>
                        )}
                      </span>
                    </>
                  )}
                </Link>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}
