"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { salvarConfigWhatsapp } from "@/app/(app)/configuracoes/actions";
import { whatsappConfigSchema } from "@/app/(app)/configuracoes/schemas";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EditorModelos, type ModeloEditavel } from "./editor-modelos";

export type EstadoWhatsapp = "conectado" | "desconectado" | "sem_chaves";

const ROTULO_ESTADO: Record<EstadoWhatsapp, string> = {
  conectado: "Conectado",
  desconectado: "Desconectado",
  sem_chaves: "Chaves da Z-API não configuradas",
};

type Props = {
  inicial: { ativo: boolean; janelaInicio: string; janelaFim: string; limitePorHora: number };
  estado: EstadoWhatsapp;
  clinica: string;
  modelos: ModeloEditavel[];
};

export function SecaoWhatsapp({ inicial, estado, clinica, modelos }: Props) {
  const [ativo, setAtivo] = useState(inicial.ativo);
  const [inicio, setInicio] = useState(inicial.janelaInicio);
  const [fim, setFim] = useState(inicial.janelaFim);
  const [limite, setLimite] = useState(String(inicial.limitePorHora));
  const [erros, setErros] = useState<{ janelaInicio?: string; janelaFim?: string; limitePorHora?: string }>({});
  const [pendente, iniciar] = useTransition();

  function enviar(e: React.FormEvent) {
    e.preventDefault();
    const dados = {
      ativo,
      janelaInicio: inicio,
      janelaFim: fim,
      limitePorHora: limite.trim() === "" ? Number.NaN : Number(limite),
    };
    const check = whatsappConfigSchema.safeParse(dados);
    if (!check.success) {
      const novos: typeof erros = {};
      for (const issue of check.error.issues) {
        const campo = issue.path[0] as keyof typeof erros;
        novos[campo] ??= issue.message;
      }
      setErros(novos);
      return;
    }
    setErros({});
    iniciar(async () => {
      const r = await salvarConfigWhatsapp(dados);
      if (r.ok) toast.success("Configurações do WhatsApp salvas.");
      else toast.error(r.erro);
    });
  }

  return (
    <section className="flex max-w-3xl flex-col gap-6" aria-labelledby="titulo-whatsapp">
      <h2 id="titulo-whatsapp" className="font-titulo text-lg font-semibold text-ouro-escuro">
        WhatsApp
      </h2>
      <form onSubmit={enviar} noValidate className="flex flex-col gap-5">
        <p className="text-sm">
          <span className="font-medium">Estado da conexão: </span>
          <span role="status" data-estado={estado}>
            {ROTULO_ESTADO[estado]}
          </span>
        </p>
        <label
          htmlFor="wa-ativo"
          className="flex min-h-11 cursor-pointer items-center gap-3 text-sm font-medium"
        >
          <Checkbox
            id="wa-ativo"
            checked={ativo}
            onCheckedChange={(v) => setAtivo(v === true)}
            disabled={pendente}
          />
          Envio automático ativo
        </label>
        <div className="grid gap-5 sm:grid-cols-3">
          <div className="flex flex-col gap-2">
            <Label htmlFor="wa-inicio">Janela de envio: início</Label>
            <Input
              id="wa-inicio"
              type="time"
              value={inicio}
              onChange={(e) => setInicio(e.target.value)}
              aria-invalid={erros.janelaInicio ? true : undefined}
            />
            {erros.janelaInicio ? (
              <p role="alert" className="text-sm font-medium text-destructive">
                {erros.janelaInicio}
              </p>
            ) : null}
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="wa-fim">Janela de envio: fim</Label>
            <Input
              id="wa-fim"
              type="time"
              value={fim}
              onChange={(e) => setFim(e.target.value)}
              aria-invalid={erros.janelaFim ? true : undefined}
            />
            {erros.janelaFim ? (
              <p role="alert" className="text-sm font-medium text-destructive">
                {erros.janelaFim}
              </p>
            ) : null}
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="wa-limite">Limite por hora</Label>
            <Input
              id="wa-limite"
              type="number"
              inputMode="numeric"
              min={1}
              max={200}
              step={1}
              value={limite}
              onChange={(e) => setLimite(e.target.value)}
              aria-invalid={erros.limitePorHora ? true : undefined}
            />
            {erros.limitePorHora ? (
              <p role="alert" className="text-sm font-medium text-destructive">
                {erros.limitePorHora}
              </p>
            ) : null}
          </div>
        </div>
        <div className="flex sm:justify-end">
          <Button type="submit" disabled={pendente} className="w-full sm:w-auto">
            {pendente ? "Salvando..." : "Salvar WhatsApp"}
          </Button>
        </div>
      </form>
      <EditorModelos modelos={modelos} clinica={clinica} />
    </section>
  );
}
