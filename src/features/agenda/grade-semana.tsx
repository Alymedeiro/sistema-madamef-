"use client";

import { chaveDia, type Intervalo } from "@/lib/dominio/intervalos";
import { combinarDataHora, dataNoFuso, formatarNoFuso } from "@/lib/dominio/tempo";
import { cn } from "@/lib/utils";
import { ColunaAgenda } from "./coluna-agenda";
import { ocupadosNoDia, ReguaHoras, sufixoProfissional, type PropsGrade } from "./grade-dia";
import { diaDaSemana, linhasDoDia, PASSO_MIN } from "./grade";

type Props = PropsGrade & {
  datas: string[];
  profissionalId: string;
};

/** Visão semana: colunas seg–dom de uma profissional. */
export function GradeSemana({
  dados,
  agendamentos,
  datas,
  profissionalId,
  podeAgendar,
  podeArrastar,
  onNovo,
  onAbrir,
}: Props) {
  const profissional = dados.profissionais.find((p) => p.id === profissionalId);
  const doProfissional = agendamentos.filter((a) => a.profissionalId === profissionalId);
  // Linhas da semana: do menor início ao maior fim entre o funcionamento dos
  // dias e os atendimentos dela (encaixes fora do horário continuam visíveis).
  const todos: Intervalo[] = datas.flatMap((d) => [
    ...dados.horarioFuncionamento[chaveDia(diaDaSemana(d))],
    ...ocupadosNoDia(doProfissional, d),
  ]);
  const linhas = linhasDoDia(todos, PASSO_MIN);

  if (!profissional) return null;
  if (linhas.length === 0) {
    return (
      <p className="rounded-xl border bg-card p-8 text-center text-muted-foreground">
        Clínica fechada nesta semana
      </p>
    );
  }

  const hoje = dataNoFuso(new Date());
  const bloqueios = dados.bloqueios.filter((b) => b.profissionalId === profissional.id);

  return (
    <div className="flex flex-col gap-3">
      {sufixoProfissional(profissional) && (
        <p role="status" className="rounded-xl border bg-card p-3 text-center text-sm font-medium">
          {profissional.nome}
          {sufixoProfissional(profissional)}: não recebe novos agendamentos.
        </p>
      )}
      <div className="overflow-x-auto rounded-xl border bg-card">
        <div className="flex min-w-fit">
          <div className="sticky left-0 z-20 bg-card">
            <div className="h-12 border-b" />
            <ReguaHoras linhas={linhas} />
          </div>
          {datas.map((data) => {
            const dia = chaveDia(diaDaSemana(data));
            const meioDia = combinarDataHora(data, "12:00");
            const rotulo = formatarNoFuso(meioDia, "EEEE, dd/MM");
            return (
              <section
                key={data}
                aria-label={`Agenda de ${rotulo}`}
                className="min-w-28 flex-1 border-l"
              >
                <h2
                  className={cn(
                    "flex h-12 flex-col items-center justify-center border-b bg-card text-sm leading-tight",
                    data === hoje && "bg-blush font-semibold text-ouro-escuro",
                  )}
                >
                  <span className="capitalize">{formatarNoFuso(meioDia, "EEE")}</span>
                  <span>{formatarNoFuso(meioDia, "dd/MM")}</span>
                </h2>
                <ColunaAgenda
                  profissionalId={profissional.id}
                  corProfissional={profissional.cor}
                  rotulo={`${profissional.nome} em ${rotulo}`}
                  data={data}
                  linhas={linhas}
                  jornadaDoDia={dados.jornadas[profissional.id]?.[dia] ?? []}
                  fechado={dados.horarioFuncionamento[dia].length === 0}
                  agendamentos={doProfissional}
                  bloqueios={bloqueios}
                  podeAgendar={podeAgendar && profissional.aceitaAgendamento}
                  podeArrastar={podeArrastar}
                  onNovo={onNovo}
                  onAbrir={onAbrir}
                />
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}
