"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { adicionarEvolucao, editarEvolucao } from "@/app/(app)/clientes/ficha/evolucoes";
import { MAX_TEXTO_EVOLUCAO } from "@/lib/dominio/evolucoes";

export const CLASSE_TEXTAREA =
  "min-h-28 w-full rounded-md border border-input bg-card px-3 py-2 text-base shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring md:text-sm";

export type AtendimentoEvolucao = { id: string; rotulo: string };

/** "Evolução / observações": nova evolução de um atendimento da profissional. */
export function CampoEvolucao({
  agendamentoId,
  atendimentos,
  onSalvo,
}: {
  /** Atendimento fixo (agenda). Sem ele, a profissional escolhe em `atendimentos`. */
  agendamentoId?: string;
  /** Atendimentos dela com a cliente; o primeiro é o mais recente (padrão). */
  atendimentos?: AtendimentoEvolucao[];
  onSalvo?: () => void;
}) {
  const router = useRouter();
  const [pendente, iniciar] = useTransition();
  const [texto, setTexto] = useState("");
  const [escolhido, setEscolhido] = useState(atendimentos?.[0]?.id ?? "");
  const alvo = agendamentoId ?? escolhido;

  function salvar() {
    iniciar(async () => {
      const r = await adicionarEvolucao(alvo, texto);
      if (!r.ok) {
        toast.error(r.erro);
        return;
      }
      toast.success("Evolução registrada.");
      setTexto("");
      onSalvo?.();
      router.refresh();
    });
  }

  if (!agendamentoId && (atendimentos?.length ?? 0) === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Você ainda não tem atendimentos com esta cliente para registrar evolução.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {!agendamentoId ? (
        <div className="flex max-w-md flex-col gap-1.5">
          <Label htmlFor="atendimento-evolucao">Atendimento</Label>
          <Select
            id="atendimento-evolucao"
            value={escolhido}
            onChange={(e) => setEscolhido(e.target.value)}
          >
            {atendimentos?.map((a) => (
              <option key={a.id} value={a.id}>
                {a.rotulo}
              </option>
            ))}
          </Select>
        </div>
      ) : null}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`texto-evolucao-${agendamentoId ?? "ficha"}`}>Evolução / observações</Label>
        <textarea
          id={`texto-evolucao-${agendamentoId ?? "ficha"}`}
          className={CLASSE_TEXTAREA}
          value={texto}
          maxLength={MAX_TEXTO_EVOLUCAO}
          onChange={(e) => setTexto(e.target.value)}
        />
      </div>
      <Button
        type="button"
        className="self-start"
        disabled={pendente || texto.trim() === "" || alvo === ""}
        onClick={salvar}
      >
        Salvar evolução
      </Button>
    </div>
  );
}

/** Texto de uma evolução; "Editar" só aparece quando `editavel`. */
export function ItemEvolucao({
  id,
  texto,
  editavel,
  onSalvo,
}: {
  id: string;
  texto: string;
  editavel: boolean;
  onSalvo?: () => void;
}) {
  const router = useRouter();
  const [pendente, iniciar] = useTransition();
  const [editando, setEditando] = useState(false);
  const [rascunho, setRascunho] = useState(texto);

  if (!editando) {
    return (
      <div className="flex flex-col gap-2">
        <p className="break-words whitespace-pre-line">{texto}</p>
        {editavel ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="min-h-11 self-start"
            onClick={() => {
              setRascunho(texto);
              setEditando(true);
            }}
          >
            Editar
          </Button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <textarea
        aria-label="Editar evolução"
        className={CLASSE_TEXTAREA}
        value={rascunho}
        maxLength={MAX_TEXTO_EVOLUCAO}
        onChange={(e) => setRascunho(e.target.value)}
      />
      <div className="flex gap-2">
        <Button
          type="button"
          disabled={pendente || rascunho.trim() === ""}
          onClick={() =>
            iniciar(async () => {
              const r = await editarEvolucao(id, rascunho);
              if (!r.ok) {
                toast.error(r.erro);
                return;
              }
              toast.success("Evolução atualizada.");
              setEditando(false);
              onSalvo?.();
              router.refresh();
            })
          }
        >
          Salvar
        </Button>
        <Button type="button" variant="outline" disabled={pendente} onClick={() => setEditando(false)}>
          Cancelar
        </Button>
      </div>
    </div>
  );
}
