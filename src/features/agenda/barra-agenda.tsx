"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { combinarDataHora, dataNoFuso, formatarNoFuso } from "@/lib/dominio/tempo";
import { cn } from "@/lib/utils";
import type { ProfissionalAgenda } from "./dados-agenda";
import { dataValida, hrefAgenda, navegar, type Visao } from "./grade";

type Props = {
  data: string;
  datas: string[];
  visao: Visao;
  profissionais: ProfissionalAgenda[];
  selecionada: string | null;
  onSelecionar: (id: string) => void;
};

function titulo(datas: string[], visao: Visao): string {
  const meioDia = (d: string) => combinarDataHora(d, "12:00");
  if (visao === "dia") return formatarNoFuso(meioDia(datas[0]), "EEEE, d 'de' MMMM 'de' yyyy");
  return `${formatarNoFuso(meioDia(datas[0]), "dd/MM")} a ${formatarNoFuso(meioDia(datas[datas.length - 1]), "dd/MM/yyyy")}`;
}

/** Navegação ‹ hoje ›, seletor de data, visão dia/semana e abas de profissional. */
export function BarraAgenda({ data, datas, visao, profissionais, selecionada, onSelecionar }: Props) {
  const router = useRouter();
  const prof = selecionada;
  const hoje = dataNoFuso(new Date());

  // Abas: no dia só no celular (no computador aparecem todas as colunas);
  // na semana sempre, pois a semana é de uma profissional.
  const mostrarAbas = profissionais.length > 1;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-titulo text-2xl font-semibold tracking-wide text-ouro-escuro">Agenda</h1>
        <div role="group" aria-label="Visão" className="inline-flex rounded-lg bg-muted p-1">
          {(["dia", "semana"] as const).map((v) => (
            <Link
              key={v}
              href={hrefAgenda({ data, visao: v, prof })}
              aria-current={visao === v ? "page" : undefined}
              className={cn(
                "inline-flex min-h-11 items-center rounded-md px-4 text-sm font-medium",
                visao === v ? "bg-card shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {v === "dia" ? "Dia" : "Semana"}
            </Link>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <Button asChild variant="outline" size="icon">
          <Link href={hrefAgenda({ data: navegar(data, visao, -1), visao, prof })} aria-label={visao === "dia" ? "Dia anterior" : "Semana anterior"}>
            <ChevronLeft aria-hidden />
          </Link>
        </Button>
        <Button asChild variant="outline" aria-current={data === hoje ? "date" : undefined}>
          <Link href={hrefAgenda({ data: hoje, visao, prof })}>Hoje</Link>
        </Button>
        <Button asChild variant="outline" size="icon">
          <Link href={hrefAgenda({ data: navegar(data, visao, 1), visao, prof })} aria-label={visao === "dia" ? "Próximo dia" : "Próxima semana"}>
            <ChevronRight aria-hidden />
          </Link>
        </Button>
        <div className="flex flex-col gap-1">
          <Label htmlFor="agenda-data" className="sr-only">
            Ir para a data
          </Label>
          <Input
            id="agenda-data"
            type="date"
            value={data}
            onChange={(e) => {
              if (dataValida(e.target.value)) router.push(hrefAgenda({ data: e.target.value, visao, prof }));
            }}
            className="w-auto"
          />
        </div>
        <p className="basis-full text-base font-medium first-letter:uppercase sm:ml-2 sm:basis-auto sm:self-center">
          {titulo(datas, visao)}
        </p>
      </div>

      {mostrarAbas && (
        <div
          role="tablist"
          aria-label="Profissional"
          className={cn("flex gap-1 overflow-x-auto rounded-lg bg-muted p-1", visao === "dia" && "lg:hidden")}
        >
          {profissionais.map((p) => (
            <button
              key={p.id}
              type="button"
              role="tab"
              aria-selected={p.id === selecionada}
              onClick={() => onSelecionar(p.id)}
              className={cn(
                "inline-flex min-h-11 shrink-0 items-center gap-2 rounded-md px-3 text-sm font-medium outline-none focus-visible:ring-[3px] focus-visible:ring-ring",
                p.id === selecionada ? "bg-card shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              <span aria-hidden className="size-3 rounded-full border" style={{ backgroundColor: p.cor }} />
              {p.nome}
              {!p.aceitaAgendamento && (
                <span className="font-normal">{p.ativa ? " (sem serviços ativos)" : " (inativa)"}</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
