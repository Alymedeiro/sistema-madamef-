"use client";

import { chaveDia } from "@/lib/dominio/intervalos";
import { cn } from "@/lib/utils";
import { ALTURA_LINHA, ColunaAgenda } from "./coluna-agenda";
import type { AgendamentoAgenda, DadosAgenda } from "./dados-agenda";
import { diaDaSemana, intervalosOcupados, linhasDoDia, PASSO_MIN } from "./grade";
import type { ProfissionalAgenda } from "./dados-agenda";

/** Sufixo da coluna que só aparece por já ter atendimentos. */
export function sufixoProfissional(p: ProfissionalAgenda): string {
  if (p.aceitaAgendamento) return "";
  return p.ativa ? " (sem serviços ativos)" : " (inativa)";
}

/** Converte os agendamentos (ISO) para intervalosOcupados. */
export function ocupadosNoDia(agendamentos: AgendamentoAgenda[], data: string) {
  return intervalosOcupados(
    agendamentos.map((a) => ({
      inicio: new Date(a.inicio),
      fim: new Date(a.fim),
      status: a.status,
    })),
    data,
  );
}

/** Régua de horas à esquerda da grade. */
export function ReguaHoras({ linhas }: { linhas: string[] }) {
  return (
    <div aria-hidden className="w-14 shrink-0 select-none">
      {linhas.map((hora) => (
        <div
          key={hora}
          className="pr-2 text-right text-xs text-muted-foreground"
          style={{ height: ALTURA_LINHA }}
        >
          {hora.endsWith(":00") || hora.endsWith(":30") ? hora : ""}
        </div>
      ))}
    </div>
  );
}

export type PropsGrade = {
  dados: DadosAgenda;
  agendamentos: AgendamentoAgenda[];
  podeAgendar: boolean;
  podeArrastar: boolean;
  onNovo: (profissionalId: string, data: string, hora: string) => void;
  onAbrir: (a: AgendamentoAgenda) => void;
};

type Props = PropsGrade & {
  data: string;
  /** No celular só a profissional selecionada aparece. */
  selecionada: string | null;
};

/** Visão dia: uma coluna por profissional, linhas de 15 min no horário de funcionamento. */
export function GradeDia({
  dados,
  agendamentos,
  data,
  selecionada,
  podeAgendar,
  podeArrastar,
  onNovo,
  onAbrir,
}: Props) {
  const dia = chaveDia(diaDaSemana(data));
  const horario = dados.horarioFuncionamento[dia];
  const fechado = horario.length === 0;
  // A grade cobre o funcionamento e também encaixes fora dele.
  const linhas = linhasDoDia([...horario, ...ocupadosNoDia(agendamentos, data)], PASSO_MIN);

  if (linhas.length === 0) {
    return (
      <p className="rounded-xl border bg-card p-8 text-center text-muted-foreground">
        Clínica fechada neste dia
      </p>
    );
  }

  const visivelNoCelular = (id: string) => id === (selecionada ?? dados.profissionais[0]?.id);

  return (
    <div className="flex flex-col gap-3">
      {fechado && (
        <p role="status" className="rounded-xl border bg-card p-3 text-center text-sm font-medium">
          Clínica fechada neste dia — há atendimentos marcados
        </p>
      )}
      <div className="overflow-x-auto rounded-xl border bg-card">
        <div className="flex min-w-fit">
          <div className="sticky left-0 z-20 bg-card">
            <div className="h-12 border-b" />
            <ReguaHoras linhas={linhas} />
          </div>
          {dados.profissionais.map((p) => (
            <section
              key={p.id}
              aria-label={`Agenda de ${p.nome}`}
              className={cn(
                "min-w-0 flex-1 border-l lg:min-w-44",
                !visivelNoCelular(p.id) && "hidden lg:block",
              )}
            >
              <h2 className="sticky top-0 z-10 flex h-12 items-center gap-2 border-b bg-card px-3 font-medium">
                <span
                  aria-hidden
                  className="size-3 shrink-0 rounded-full border"
                  style={{ backgroundColor: p.cor }}
                />
                <span className="truncate">
                  {p.nome}
                  {sufixoProfissional(p) && (
                    <span className="text-sm font-normal text-muted-foreground">
                      {sufixoProfissional(p)}
                    </span>
                  )}
                </span>
              </h2>
              <ColunaAgenda
                profissionalId={p.id}
                corProfissional={p.cor}
                rotulo={p.nome}
                data={data}
                linhas={linhas}
                jornadaDoDia={dados.jornadas[p.id]?.[dia] ?? []}
                fechado={fechado}
                agendamentos={agendamentos.filter((a) => a.profissionalId === p.id)}
                bloqueios={dados.bloqueios.filter((b) => b.profissionalId === p.id)}
                podeAgendar={podeAgendar && p.aceitaAgendamento}
                podeArrastar={podeArrastar}
                onNovo={onNovo}
                onAbrir={onAbrir}
              />
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
