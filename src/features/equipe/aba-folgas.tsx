"use client";

import { useState, useTransition } from "react";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { bloqueioSchema } from "@/app/(app)/equipe/schemas";
import { adicionarBloqueio, removerBloqueio } from "@/app/(app)/equipe/actions";

export type BloqueioItem = {
  id: string;
  /** Já formatado em horário de São Paulo (dd/MM/yyyy HH:mm). */
  inicioTexto: string;
  fimTexto: string;
  motivo: string;
};

type Props = { colaboradorId: string; bloqueios: BloqueioItem[] };

export function AbaFolgas({ colaboradorId, bloqueios }: Props) {
  const [inicio, setInicio] = useState("");
  const [fim, setFim] = useState("");
  const [motivo, setMotivo] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();

  function adicionar(e: React.FormEvent) {
    e.preventDefault();
    const check = bloqueioSchema.safeParse({ inicio, fim, motivo });
    if (!check.success) {
      setErro(check.error.issues[0].message);
      return;
    }
    setErro(null);
    iniciar(async () => {
      const r = await adicionarBloqueio(colaboradorId, inicio, fim, motivo);
      if (r.ok) {
        toast.success("Folga adicionada.");
        setInicio("");
        setFim("");
        setMotivo("");
      } else toast.error(r.erro);
    });
  }

  function remover(id: string) {
    iniciar(async () => {
      const r = await removerBloqueio(id);
      if (r.ok) toast.success("Folga removida.");
      else toast.error(r.erro);
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <form onSubmit={adicionar} noValidate className="flex max-w-2xl flex-col gap-4">
        <p className="text-sm text-muted-foreground">
          Folgas, férias e ausências bloqueiam a agenda da profissional no período. Horários de
          São Paulo.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="bloqueio-inicio">Início</Label>
            <Input
              id="bloqueio-inicio"
              type="datetime-local"
              value={inicio}
              onChange={(e) => setInicio(e.target.value)}
              required
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="bloqueio-fim">Fim</Label>
            <Input
              id="bloqueio-fim"
              type="datetime-local"
              value={fim}
              onChange={(e) => setFim(e.target.value)}
              required
            />
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="bloqueio-motivo">Motivo</Label>
          <Input
            id="bloqueio-motivo"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="Ex.: Férias, consulta médica"
            required
          />
        </div>
        {erro ? (
          <p role="alert" className="text-sm font-medium text-destructive">
            {erro}
          </p>
        ) : null}
        <div>
          <Button type="submit" disabled={pendente} className="w-full sm:w-auto">
            {pendente ? "Salvando..." : "Adicionar folga"}
          </Button>
        </div>
      </form>

      <section aria-labelledby="titulo-proximas-folgas" className="flex flex-col gap-3">
        <h3 id="titulo-proximas-folgas" className="font-semibold">
          Folgas e férias em andamento ou futuras
        </h3>
        {bloqueios.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma folga cadastrada.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {bloqueios.map((b) => (
              <li
                key={b.id}
                className="flex items-center justify-between gap-3 rounded-lg border bg-card p-3"
              >
                <div className="min-w-0">
                  <p className="font-medium break-words">{b.motivo}</p>
                  <p className="text-sm text-muted-foreground">
                    {b.inicioTexto} até {b.fimTexto}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  disabled={pendente}
                  onClick={() => remover(b.id)}
                  aria-label={`Remover folga: ${b.motivo}`}
                >
                  <Trash2 aria-hidden />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
