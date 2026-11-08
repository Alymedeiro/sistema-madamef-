"use client";

import { combinarDataHora, formatarNoFuso } from "@/lib/dominio/tempo";
import { cn } from "@/lib/utils";

const botao = (marcado: boolean) =>
  cn(
    "flex min-h-11 min-w-11 flex-col items-center justify-center rounded-md border bg-card px-2 py-2 text-sm shadow-xs transition-colors",
    "outline-none focus-visible:ring-[3px] focus-visible:ring-ring hover:bg-accent",
    marcado && "border-primary bg-primary font-semibold text-primary-foreground hover:bg-ouro-escuro",
  );

export function PassoHorario({
  dias,
  dia,
  horarios,
  carregando,
  erro,
  inicio,
  aoEscolherDia,
  aoEscolherHorario,
}: {
  dias: string[];
  dia: string | null;
  horarios: string[] | null;
  carregando: boolean;
  erro: string | null;
  inicio: string | null;
  aoEscolherDia: (dia: string) => void;
  aoEscolherHorario: (inicio: string) => void;
}) {
  return (
    <fieldset className="flex min-w-0 flex-col gap-4">
      <legend className="mb-3 font-titulo text-lg font-semibold text-ouro-escuro">
        3. Dia e horário
      </legend>
      <div
        role="group"
        aria-label="Dia"
        className="-mx-1 flex snap-x gap-2 overflow-x-auto px-1 pb-2"
      >
        {dias.map((d) => {
          const meioDia = combinarDataHora(d, "12:00");
          return (
            <button
              key={d}
              type="button"
              aria-pressed={dia === d}
              aria-label={formatarNoFuso(meioDia, "EEEE, d 'de' MMMM")}
              className={cn(botao(dia === d), "w-16 shrink-0 snap-start")}
              onClick={() => aoEscolherDia(d)}
            >
              <span className="text-xs capitalize">{formatarNoFuso(meioDia, "EEE")}</span>
              <span className="text-base">{formatarNoFuso(meioDia, "dd/MM")}</span>
            </button>
          );
        })}
      </div>

      <div aria-live="polite" className="flex flex-col gap-3">
        {!dia ? <p className="text-sm text-muted-foreground">Escolha um dia.</p> : null}
        {dia && carregando ? <p className="text-sm">Buscando horários...</p> : null}
        {erro ? (
          <p role="alert" className="text-sm font-medium text-destructive">
            {erro}
          </p>
        ) : null}
        {dia && !carregando && horarios?.length === 0 ? (
          <p className="text-sm">Nenhum horário livre neste dia. Escolha outro dia.</p>
        ) : null}
        {dia && !carregando && horarios && horarios.length > 0 ? (
          <div role="group" aria-label="Horário" className="grid grid-cols-4 gap-2 sm:grid-cols-6">
            {horarios.map((h) => (
              <button
                key={h}
                type="button"
                aria-pressed={inicio === h}
                className={botao(inicio === h)}
                onClick={() => aoEscolherHorario(h)}
              >
                {formatarNoFuso(h, "HH:mm")}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </fieldset>
  );
}
