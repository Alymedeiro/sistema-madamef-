"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  achatarJornadasPorDia,
  type IntervalosPorDia,
} from "@/lib/dominio/intervalos";
import { jornadasSchema } from "@/app/(app)/equipe/schemas";
import { salvarJornadas } from "@/app/(app)/equipe/actions";
import { EditorIntervalos } from "./editor-intervalos";

type Props = { colaboradorId: string; inicial: IntervalosPorDia };

export function AbaJornada({ colaboradorId, inicial }: Props) {
  const [valor, setValor] = useState<IntervalosPorDia>(inicial);
  const [pendente, iniciar] = useTransition();

  function salvar() {
    const linhas = achatarJornadasPorDia(valor);
    const check = jornadasSchema.safeParse(linhas);
    if (!check.success) {
      toast.error(check.error.issues[0].message);
      return;
    }
    iniciar(async () => {
      const r = await salvarJornadas(colaboradorId, linhas);
      if (r.ok) toast.success("Jornada salva.");
      else toast.error(r.erro);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        Horários em que a profissional atende em cada dia. Para uma pausa de almoço, use dois
        intervalos (por exemplo, 09:00 às 12:00 e 13:00 às 18:00). Dia sem horário = não atende.
      </p>
      <EditorIntervalos valor={valor} onChange={setValor} disabled={pendente} textoFechado="Não atende" />
      <div className="flex sm:justify-end">
        <Button type="button" onClick={salvar} disabled={pendente} className="w-full sm:w-auto">
          {pendente ? "Salvando..." : "Salvar jornada"}
        </Button>
      </div>
    </div>
  );
}
