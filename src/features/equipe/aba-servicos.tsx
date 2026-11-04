"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { salvarServicosDoColaborador } from "@/app/(app)/equipe/actions";

export type ServicoOpcao = { id: string; nome: string; categoria: string };

type Props = {
  colaboradorId: string;
  servicos: ServicoOpcao[];
  selecionados: string[];
};

export function AbaServicos({ colaboradorId, servicos, selecionados }: Props) {
  const [marcados, setMarcados] = useState<Set<string>>(new Set(selecionados));
  const [pendente, iniciar] = useTransition();

  function alternar(id: string, marcado: boolean) {
    setMarcados((atual) => {
      const novo = new Set(atual);
      if (marcado) novo.add(id);
      else novo.delete(id);
      return novo;
    });
  }

  function salvar() {
    iniciar(async () => {
      const r = await salvarServicosDoColaborador(colaboradorId, [...marcados]);
      if (r.ok) toast.success("Serviços salvos.");
      else toast.error(r.erro);
    });
  }

  if (servicos.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Ainda não há serviços ativos cadastrados. Cadastre os serviços primeiro.
      </p>
    );
  }

  const categorias = [...new Set(servicos.map((s) => s.categoria))];

  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-muted-foreground">
        Marque os serviços que esta profissional realiza. Só eles aparecem para ela na agenda.
      </p>
      {categorias.map((categoria) => (
        <fieldset key={categoria} className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-semibold text-ouro-escuro">{categoria}</legend>
          {servicos
            .filter((s) => s.categoria === categoria)
            .map((s) => {
              const idCheck = `servico-${s.id}`;
              return (
                <label
                  key={s.id}
                  htmlFor={idCheck}
                  className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border bg-card px-3"
                >
                  <Checkbox
                    id={idCheck}
                    checked={marcados.has(s.id)}
                    disabled={pendente}
                    onCheckedChange={(v) => alternar(s.id, v === true)}
                  />
                  <span className="text-sm">{s.nome}</span>
                </label>
              );
            })}
        </fieldset>
      ))}
      <div className="flex sm:justify-end">
        <Button type="button" onClick={salvar} disabled={pendente} className="w-full sm:w-auto">
          {pendente ? "Salvando..." : "Salvar serviços"}
        </Button>
      </div>
    </div>
  );
}
