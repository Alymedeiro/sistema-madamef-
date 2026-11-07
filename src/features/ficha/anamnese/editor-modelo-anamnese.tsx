"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { salvarModeloAnamnese } from "@/app/(app)/configuracoes/anamnese/actions";
import {
  ROTULO_TIPO_PERGUNTA,
  erroDasPerguntas,
  gerarIdPergunta,
  type Pergunta,
  type TipoPergunta,
} from "@/lib/dominio/anamnese";

type Linha = {
  chave: string;
  /** Perguntas novas ainda não têm id: ele nasce do texto ao salvar. */
  id: string | null;
  tipo: TipoPergunta;
  texto: string;
  obrigatoria: boolean;
  alerta: boolean;
  opcoes: string;
};

let contador = 0;
const novaChave = () => `n${++contador}`;

const PODE_ALERTA: TipoPergunta[] = ["sim_nao", "sim_nao_detalhe"];

function deModelo(p: Pergunta): Linha {
  return {
    chave: p.id,
    id: p.id,
    tipo: p.tipo,
    texto: p.texto,
    obrigatoria: p.obrigatoria,
    alerta: !!p.alerta,
    opcoes: (p.opcoes ?? []).join("\n"),
  };
}

function paraPerguntas(linhas: Linha[]): Pergunta[] {
  const usados: string[] = linhas.flatMap((l) => (l.id ? [l.id] : []));
  return linhas.map((l) => {
    const id = l.id ?? gerarIdPergunta(l.texto, usados);
    if (!l.id) usados.push(id);
    return {
      id,
      tipo: l.tipo,
      texto: l.texto.trim(),
      obrigatoria: l.obrigatoria,
      alerta: PODE_ALERTA.includes(l.tipo) ? l.alerta : false,
      ...(l.tipo === "multipla"
        ? { opcoes: l.opcoes.split("\n").map((o) => o.trim()).filter(Boolean) }
        : {}),
    };
  });
}

export function EditorModeloAnamnese({
  titulo: tituloInicial,
  versao,
  perguntas,
}: {
  titulo: string;
  versao: number;
  perguntas: Pergunta[];
}) {
  const [titulo, setTitulo] = useState(tituloInicial);
  const [linhas, setLinhas] = useState<Linha[]>(() => perguntas.map(deModelo));
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();

  function mudar(chave: string, parcial: Partial<Linha>) {
    setLinhas((ls) => ls.map((l) => (l.chave === chave ? { ...l, ...parcial } : l)));
  }
  function mover(i: number, delta: -1 | 1) {
    setLinhas((ls) => {
      const j = i + delta;
      if (j < 0 || j >= ls.length) return ls;
      const copia = [...ls];
      [copia[i], copia[j]] = [copia[j], copia[i]];
      return copia;
    });
  }

  function salvar() {
    if (!titulo.trim()) {
      setErro("Informe o título do modelo.");
      return;
    }
    const lista = paraPerguntas(linhas);
    const e = erroDasPerguntas(lista);
    if (e) {
      setErro(e);
      return;
    }
    setErro(null);
    iniciar(async () => {
      const r = await salvarModeloAnamnese({ titulo, perguntas: lista });
      if (r.ok) toast.success("Modelo salvo.");
      else {
        setErro(r.erro);
        toast.error(r.erro);
      }
    });
  }

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <p className="text-sm text-muted-foreground">
        Versão atual: {versao}. Ao salvar com mudanças, nasce uma nova versão; as anamneses
        já preenchidas continuam com as perguntas da versão em que foram respondidas.
      </p>
      <div className="flex flex-col gap-2">
        <Label htmlFor="modelo-titulo">Título</Label>
        <Input id="modelo-titulo" value={titulo} onChange={(e) => setTitulo(e.target.value)} />
      </div>

      <ol className="flex flex-col gap-4">
        {linhas.map((l, i) => (
          <li key={l.chave} className="flex flex-col gap-3 rounded-xl border bg-card p-4">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-muted-foreground">Pergunta {i + 1}</span>
              <div className="ml-auto flex gap-1">
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  aria-label={`Subir a pergunta ${i + 1}`}
                  disabled={i === 0}
                  onClick={() => mover(i, -1)}
                >
                  ↑
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  aria-label={`Descer a pergunta ${i + 1}`}
                  disabled={i === linhas.length - 1}
                  onClick={() => mover(i, 1)}
                >
                  ↓
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  className="text-destructive"
                  onClick={() => setLinhas((ls) => ls.filter((x) => x.chave !== l.chave))}
                >
                  Remover
                </Button>
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor={`texto-${l.chave}`}>Texto da pergunta</Label>
              <Input
                id={`texto-${l.chave}`}
                value={l.texto}
                onChange={(e) => mudar(l.chave, { texto: e.target.value })}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor={`tipo-${l.chave}`}>Tipo</Label>
              <Select
                id={`tipo-${l.chave}`}
                value={l.tipo}
                onChange={(e) => {
                  const tipo = e.target.value as TipoPergunta;
                  mudar(l.chave, {
                    tipo,
                    alerta: PODE_ALERTA.includes(tipo) ? l.alerta : false,
                  });
                }}
              >
                {(Object.keys(ROTULO_TIPO_PERGUNTA) as TipoPergunta[]).map((t) => (
                  <option key={t} value={t}>
                    {ROTULO_TIPO_PERGUNTA[t]}
                  </option>
                ))}
              </Select>
            </div>
            {l.tipo === "multipla" ? (
              <div className="flex flex-col gap-2">
                <Label htmlFor={`opcoes-${l.chave}`}>Opções (uma por linha)</Label>
                <textarea
                  id={`opcoes-${l.chave}`}
                  rows={4}
                  value={l.opcoes}
                  onChange={(e) => mudar(l.chave, { opcoes: e.target.value })}
                  className="w-full rounded-md border border-input bg-card p-3 text-base shadow-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring"
                />
              </div>
            ) : null}
            <div className="flex flex-wrap gap-x-6">
              <label className="flex min-h-11 items-center gap-2 text-sm">
                <Checkbox
                  checked={l.obrigatoria}
                  onCheckedChange={(v) => mudar(l.chave, { obrigatoria: v === true })}
                />
                Obrigatória
              </label>
              {PODE_ALERTA.includes(l.tipo) ? (
                <label className="flex min-h-11 items-center gap-2 text-sm">
                  <Checkbox
                    checked={l.alerta}
                    onCheckedChange={(v) => mudar(l.chave, { alerta: v === true })}
                  />
                  Alerta (avisa na ficha e na agenda quando a resposta for sim)
                </label>
              ) : null}
            </div>
          </li>
        ))}
      </ol>

      <Button
        type="button"
        variant="outline"
        className="self-start"
        onClick={() =>
          setLinhas((ls) => [
            ...ls,
            {
              chave: novaChave(),
              id: null,
              tipo: "texto",
              texto: "",
              obrigatoria: false,
              alerta: false,
              opcoes: "",
            },
          ])
        }
      >
        Adicionar pergunta
      </Button>

      {erro ? (
        <p role="alert" className="text-sm font-medium text-destructive">
          {erro}
        </p>
      ) : null}
      <Button type="button" className="self-start" disabled={pendente} onClick={salvar}>
        {pendente ? "Salvando…" : "Salvar nova versão"}
      </Button>
    </div>
  );
}
