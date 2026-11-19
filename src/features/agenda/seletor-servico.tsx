"use client";

import { useId, useState } from "react";
import { Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { servicoCombinaBusca } from "@/lib/dominio/catalogo";
import { formatarBRL } from "@/lib/dominio/dinheiro";
import { cn } from "@/lib/utils";
import type { ServicoAgenda } from "./dados-agenda";

type Props = {
  rotulo: string;
  servicos: ServicoAgenda[];
  valor: string;
  onEscolher: (id: string) => void;
  /** Botão "x" para tirar a linha (serviços adicionais). */
  onRemover?: () => void;
  /** Horário calculado da linha, ex.: "09:15–09:35". */
  horario?: string;
};

export function descreverServico(s: ServicoAgenda) {
  return `${s.nome} · ${s.duracaoMin} min · ${formatarBRL(s.precoCentavos)}`;
}

/** Campo de serviço com busca: digite parte do nome e escolha na lista. */
export function SeletorServico({ rotulo, servicos, valor, onEscolher, onRemover, horario }: Props) {
  const id = useId();
  const [termo, setTermo] = useState("");
  const [aberto, setAberto] = useState(false);
  const [ativo, setAtivo] = useState(0);
  const escolhido = servicos.find((s) => s.id === valor);
  const lista = servicos.filter((s) => servicoCombinaBusca(s.nome, "", termo));

  function escolher(s: ServicoAgenda) {
    onEscolher(s.id);
    setTermo("");
    setAberto(false);
  }

  const textoRotulo = (
    <>
      {rotulo}
      {horario ? <span className="ml-2 font-normal text-muted-foreground">{horario}</span> : null}
    </>
  );
  const cabecalho = (
    <div className="flex items-center justify-between gap-2">
      {escolhido ? (
        <span className="text-sm font-medium">{textoRotulo}</span>
      ) : (
        <label htmlFor={`${id}-busca`} className="text-sm font-medium">
          {textoRotulo}
        </label>
      )}
      {onRemover ? (
        <Button type="button" variant="ghost" size="sm" onClick={onRemover}>
          <X aria-hidden />
          Remover<span className="sr-only"> {rotulo}</span>
        </Button>
      ) : null}
    </div>
  );

  if (escolhido) {
    return (
      <div className="flex flex-col gap-2">
        {cabecalho}
        <div className="flex min-h-11 items-center justify-between gap-2 rounded-md border bg-blush px-3">
          <span className="min-w-0 truncate font-medium">
            {descreverServico(escolhido)}
          </span>
          <Button type="button" variant="ghost" size="sm" onClick={() => onEscolher("")}>
            <X aria-hidden />
            Trocar
          </Button>
        </div>
      </div>
    );
  }

  function tecla(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setAberto(true);
      setAtivo((i) => Math.min(i + 1, lista.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setAtivo((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && aberto && lista[ativo]) {
      e.preventDefault();
      escolher(lista[ativo]);
    } else if (e.key === "Escape" && aberto) {
      e.preventDefault();
      setAberto(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {cabecalho}
      <div className="relative">
        <Search
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          id={`${id}-busca`}
          type="search"
          role="combobox"
          aria-expanded={aberto}
          aria-controls={`${id}-lista`}
          aria-autocomplete="list"
          aria-activedescendant={aberto && lista[ativo] ? `${id}-op-${lista[ativo].id}` : undefined}
          value={termo}
          onChange={(e) => {
            setTermo(e.target.value);
            setAtivo(0);
            setAberto(true);
          }}
          onFocus={() => setAberto(true)}
          onBlur={() => setTimeout(() => setAberto(false), 150)}
          onKeyDown={tecla}
          placeholder="Digite para buscar o serviço"
          autoComplete="off"
          className="pl-9"
        />
      </div>
      {aberto && (
        <ul
          id={`${id}-lista`}
          role="listbox"
          aria-label="Serviços"
          className="flex max-h-56 flex-col overflow-y-auto rounded-md border bg-card"
        >
          {lista.length === 0 ? (
            <li className="px-3 py-2 text-sm text-muted-foreground">Nenhum serviço encontrado.</li>
          ) : (
            lista.map((s, i) => (
              <li
                key={s.id}
                id={`${id}-op-${s.id}`}
                role="option"
                aria-selected={i === ativo}
                // pointerdown antes do blur do campo, para o clique valer.
                onPointerDown={(e) => {
                  e.preventDefault();
                  escolher(s);
                }}
                onMouseEnter={() => setAtivo(i)}
                className={cn(
                  "flex min-h-11 cursor-pointer items-center px-3 py-1 text-sm",
                  i === ativo && "bg-blush",
                )}
              >
                {descreverServico(s)}
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
