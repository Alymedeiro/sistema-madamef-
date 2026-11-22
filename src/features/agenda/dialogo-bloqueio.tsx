"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { excluirBloqueioAgenda, salvarBloqueioAgenda } from "@/app/(app)/agenda/actions";
import { dataNoFuso, horaNoFuso } from "@/lib/dominio/tempo";
import type { BloqueioAgenda, ProfissionalAgenda } from "./dados-agenda";

export type EstadoBloqueio =
  | { modo: "novo"; profissionalId: string; data: string }
  | { modo: "editar"; bloqueio: BloqueioAgenda };

/** "yyyy-MM-ddTHH:mm" em São Paulo, para <input type="datetime-local">. */
const local = (iso: string) => `${dataNoFuso(iso)}T${horaNoFuso(iso)}`;

/** Criar, editar ou remover um bloqueio direto da agenda (só a dona). */
export function DialogoBloqueio({
  estado,
  profissionais,
  onFechar,
}: {
  estado: EstadoBloqueio | null;
  profissionais: ProfissionalAgenda[];
  onFechar: () => void;
}) {
  const chave =
    estado?.modo === "editar"
      ? estado.bloqueio.id
      : estado
        ? `novo-${estado.profissionalId}-${estado.data}`
        : "fechado";
  return (
    <Dialog open={!!estado} onOpenChange={(v) => !v && onFechar()}>
      <DialogContent>
        {estado && (
          <Formulario key={chave} estado={estado} profissionais={profissionais} onFechar={onFechar} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function Formulario({
  estado,
  profissionais,
  onFechar,
}: {
  estado: EstadoBloqueio;
  profissionais: ProfissionalAgenda[];
  onFechar: () => void;
}) {
  const router = useRouter();
  const editando = estado.modo === "editar";
  const [v, setV] = useState(() =>
    estado.modo === "editar"
      ? {
          profissionalId: estado.bloqueio.profissionalId,
          inicio: local(estado.bloqueio.inicio),
          fim: local(estado.bloqueio.fim),
          motivo: estado.bloqueio.motivo,
        }
      : {
          profissionalId: estado.profissionalId,
          inicio: `${estado.data}T09:00`,
          fim: `${estado.data}T18:00`,
          motivo: "",
        },
  );
  const [erro, setErro] = useState<string | null>(null);
  const [confirmarRemocao, setConfirmarRemocao] = useState(false);
  const [pendente, iniciar] = useTransition();

  function salvar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    iniciar(async () => {
      const r = await salvarBloqueioAgenda({
        id: editando ? estado.bloqueio.id : undefined,
        ...v,
      });
      if (r.ok) {
        toast.success(editando ? "Bloqueio atualizado." : "Horário bloqueado.");
        onFechar();
        router.refresh();
      } else {
        setErro(r.erro);
      }
    });
  }

  function remover() {
    if (!editando) return;
    iniciar(async () => {
      const r = await excluirBloqueioAgenda(estado.bloqueio.id);
      if (r.ok) {
        toast.success("Bloqueio removido.");
        onFechar();
        router.refresh();
      } else {
        setErro(r.erro);
      }
    });
  }

  return (
    <form onSubmit={salvar} noValidate className="flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>{editando ? "Editar bloqueio" : "Bloquear horário"}</DialogTitle>
        <DialogDescription>
          Horários de São Paulo. No período bloqueado não é possível agendar.
        </DialogDescription>
      </DialogHeader>

      <div className="flex flex-col gap-2">
        <Label htmlFor="bloqueio-prof">Profissional</Label>
        <Select
          id="bloqueio-prof"
          value={v.profissionalId}
          onChange={(e) => setV((x) => ({ ...x, profissionalId: e.target.value }))}
        >
          {profissionais.map((p) => (
            <option key={p.id} value={p.id}>
              {p.nome}
            </option>
          ))}
        </Select>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor="bloqueio-inicio">Início</Label>
          <Input
            id="bloqueio-inicio"
            type="datetime-local"
            step={300}
            value={v.inicio}
            onChange={(e) => setV((x) => ({ ...x, inicio: e.target.value }))}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="bloqueio-fim">Fim</Label>
          <Input
            id="bloqueio-fim"
            type="datetime-local"
            step={300}
            value={v.fim}
            onChange={(e) => setV((x) => ({ ...x, fim: e.target.value }))}
          />
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="bloqueio-motivo">Motivo</Label>
        <Input
          id="bloqueio-motivo"
          value={v.motivo}
          maxLength={200}
          placeholder="Ex.: Folga, curso, consulta médica"
          onChange={(e) => setV((x) => ({ ...x, motivo: e.target.value }))}
        />
      </div>

      {erro && (
        <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          {erro}
        </p>
      )}

      <DialogFooter className="gap-2 sm:justify-between">
        {editando ? (
          confirmarRemocao ? (
            <Button type="button" variant="destructive" onClick={remover} disabled={pendente}>
              Confirmar remoção
            </Button>
          ) : (
            <Button type="button" variant="outline" onClick={() => setConfirmarRemocao(true)} disabled={pendente}>
              Remover bloqueio
            </Button>
          )
        ) : (
          <span />
        )}
        <Button type="submit" disabled={pendente}>
          {pendente ? "Salvando…" : "Salvar"}
        </Button>
      </DialogFooter>
    </form>
  );
}
