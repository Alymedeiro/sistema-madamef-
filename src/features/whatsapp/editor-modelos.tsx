"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { salvarModelo } from "@/app/(app)/configuracoes/actions";
import { modeloSchema, type TipoModelo } from "@/app/(app)/configuracoes/schemas";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { ROTULO_TIPO_MENSAGEM, VARIAVEIS_MENSAGEM } from "@/lib/dominio/whatsapp";
import { previaMensagem } from "./previa";

export type ModeloEditavel = { tipo: TipoModelo; variacoes: string[]; ativo: boolean };

const CLASSE_TEXTAREA =
  "min-h-11 w-full rounded-md border border-input bg-card px-3 py-2 text-base shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring md:text-sm";

function CartaoModelo({ modelo, clinica }: { modelo: ModeloEditavel; clinica: string }) {
  const [variacoes, setVariacoes] = useState(modelo.variacoes);
  const [ativo, setAtivo] = useState(modelo.ativo);
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();
  const rotulo = ROTULO_TIPO_MENSAGEM[modelo.tipo];

  function salvar() {
    const dados = { tipo: modelo.tipo, variacoes, ativo };
    const check = modeloSchema.safeParse(dados);
    if (!check.success) {
      setErro(check.error.issues[0].message);
      return;
    }
    setErro(null);
    iniciar(async () => {
      const r = await salvarModelo(dados);
      if (r.ok) toast.success(`Modelo "${rotulo}" salvo.`);
      else toast.error(r.erro);
    });
  }

  return (
    <article className="flex flex-col gap-4 rounded-md border bg-card p-4" aria-label={`Modelo ${rotulo}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h4 className="font-medium">{rotulo}</h4>
        <label
          htmlFor={`modelo-ativo-${modelo.tipo}`}
          className="flex min-h-11 cursor-pointer items-center gap-3 text-sm"
        >
          <Checkbox
            id={`modelo-ativo-${modelo.tipo}`}
            checked={ativo}
            onCheckedChange={(v) => setAtivo(v === true)}
            disabled={pendente}
          />
          Modelo ativo
        </label>
      </div>
      {variacoes.map((texto, i) => (
        <div key={i} className="flex flex-col gap-2">
          <Label htmlFor={`modelo-${modelo.tipo}-${i}`}>Variação {i + 1}</Label>
          <textarea
            id={`modelo-${modelo.tipo}-${i}`}
            value={texto}
            rows={3}
            maxLength={1000}
            onChange={(e) => setVariacoes(variacoes.map((v, j) => (j === i ? e.target.value : v)))}
            className={CLASSE_TEXTAREA}
          />
          <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
            <span className="font-medium">Prévia: </span>
            {previaMensagem(texto, clinica) || "(vazia)"}
          </p>
          {variacoes.length > 1 ? (
            <Button
              type="button"
              variant="outline"
              className="self-start"
              disabled={pendente}
              onClick={() => setVariacoes(variacoes.filter((_, j) => j !== i))}
            >
              Remover variação {i + 1}
            </Button>
          ) : null}
        </div>
      ))}
      {erro ? (
        <p role="alert" className="text-sm font-medium text-destructive">
          {erro}
        </p>
      ) : null}
      <div className="flex flex-col gap-2 sm:flex-row sm:justify-between">
        <Button
          type="button"
          variant="outline"
          disabled={pendente || variacoes.length >= 5}
          onClick={() => setVariacoes([...variacoes, ""])}
        >
          Adicionar variação
        </Button>
        <Button type="button" disabled={pendente} onClick={salvar}>
          {pendente ? "Salvando..." : `Salvar modelo ${rotulo}`}
        </Button>
      </div>
    </article>
  );
}

export function EditorModelos({ modelos, clinica }: { modelos: ModeloEditavel[]; clinica: string }) {
  return (
    <div className="flex flex-col gap-4">
      <h3 className="font-titulo text-base font-semibold text-ouro-escuro">Modelos de mensagem</h3>
      <p className="text-sm text-muted-foreground">
        Com mais de uma variação, uma é sorteada a cada envio. Variáveis:{" "}
        {VARIAVEIS_MENSAGEM.map((v, i) => (
          <span key={v}>
            {i > 0 ? ", " : ""}
            <code>{`{${v}}`}</code>
          </span>
        ))}
        . A prévia usa dados de exemplo.
      </p>
      {modelos.map((m) => (
        <CartaoModelo key={m.tipo} modelo={m} clinica={clinica} />
      ))}
    </div>
  );
}
