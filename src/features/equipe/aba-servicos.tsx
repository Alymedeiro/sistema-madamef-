"use client";

import { useState, useTransition } from "react";
import { Search } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { servicoCombinaBusca } from "@/lib/dominio/catalogo";
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
  const [busca, setBusca] = useState("");

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

  // A busca só esconde itens da tela: os marcados fora dela continuam salvos.
  const visiveis = servicos.filter((s) => servicoCombinaBusca(s.nome, s.categoria, busca));
  const categorias = [...new Set(visiveis.map((s) => s.categoria))];

  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-muted-foreground">
        Marque os serviços que esta profissional realiza. Só eles aparecem para ela na agenda.
      </p>
      <div role="search" className="relative max-w-xl">
        <Search
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          type="search"
          inputMode="search"
          aria-label="Buscar serviço"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar serviço"
          autoComplete="off"
          className="pl-9"
        />
      </div>
      {visiveis.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhum serviço encontrado.</p>
      ) : null}
      {categorias.map((categoria) => (
        <fieldset key={categoria} className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-semibold text-ouro-escuro">{categoria}</legend>
          {visiveis
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
