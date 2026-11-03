"use client";

import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  chaveDia,
  NOME_DIA,
  ORDEM_DIAS,
  type Intervalo,
  type IntervalosPorDia,
} from "@/lib/dominio/intervalos";

type Props = {
  valor: IntervalosPorDia;
  onChange: (novo: IntervalosPorDia) => void;
  disabled?: boolean;
  /** Texto exibido no dia sem intervalos. */
  textoFechado?: string;
};

/** Grade segunda a domingo; cada dia tem zero ou mais intervalos (início e fim). */
export function EditorIntervalos({
  valor,
  onChange,
  disabled,
  textoFechado = "Fechado",
}: Props) {
  function atualizarDia(dia: number, intervalos: Intervalo[]) {
    onChange({ ...valor, [chaveDia(dia)]: intervalos });
  }

  return (
    <ul className="flex flex-col gap-3">
      {ORDEM_DIAS.map((dia) => {
        const intervalos = valor[chaveDia(dia)];
        const nome = NOME_DIA[dia];
        return (
          <li
            key={dia}
            className="flex flex-col gap-3 rounded-lg border bg-card p-3 sm:flex-row sm:items-start"
          >
            <span className="w-36 shrink-0 pt-3 text-sm font-medium">{nome}</span>
            <div className="flex flex-1 flex-col gap-2">
              {intervalos.length === 0 ? (
                <span className="pt-3 text-sm text-muted-foreground">{textoFechado}</span>
              ) : (
                intervalos.map((intervalo, idx) => (
                  <div key={idx} className="flex flex-wrap items-center gap-2">
                    <Input
                      type="time"
                      aria-label={`${nome}: início do intervalo ${idx + 1}`}
                      value={intervalo.inicio}
                      disabled={disabled}
                      className="w-32"
                      onChange={(e) =>
                        atualizarDia(
                          dia,
                          intervalos.map((i, n) =>
                            n === idx ? { ...i, inicio: e.target.value } : i,
                          ),
                        )
                      }
                    />
                    <span aria-hidden className="text-sm text-muted-foreground">
                      às
                    </span>
                    <Input
                      type="time"
                      aria-label={`${nome}: fim do intervalo ${idx + 1}`}
                      value={intervalo.fim}
                      disabled={disabled}
                      className="w-32"
                      onChange={(e) =>
                        atualizarDia(
                          dia,
                          intervalos.map((i, n) =>
                            n === idx ? { ...i, fim: e.target.value } : i,
                          ),
                        )
                      }
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      disabled={disabled}
                      aria-label={`${nome}: remover intervalo ${idx + 1}`}
                      onClick={() =>
                        atualizarDia(
                          dia,
                          intervalos.filter((_, n) => n !== idx),
                        )
                      }
                    >
                      <Trash2 aria-hidden />
                    </Button>
                  </div>
                ))
              )}
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={disabled}
              className="self-start"
              onClick={() => {
                const ultimo = intervalos[intervalos.length - 1];
                atualizarDia(dia, [
                  ...intervalos,
                  ultimo && ultimo.fim < "18:00"
                    ? { inicio: ultimo.fim, fim: "18:00" }
                    : { inicio: "09:00", fim: "18:00" },
                ]);
              }}
            >
              <Plus aria-hidden />
              Adicionar horário
              <span className="sr-only"> em {nome}</span>
            </Button>
          </li>
        );
      })}
    </ul>
  );
}
