"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { RotateCcw, X } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { cancelarMensagem, reenviarMensagem } from "@/app/(app)/mensagens/actions";
import type { FiltroFila, ItemFila } from "@/app/(app)/mensagens/dados";
import { formatarTelefone } from "@/lib/dominio/telefone";
import { formatarNoFuso } from "@/lib/dominio/tempo";
import {
  ROTULO_STATUS_MENSAGEM,
  ROTULO_TIPO_MENSAGEM,
  type StatusMensagem,
} from "@/lib/dominio/whatsapp";
import { cn } from "@/lib/utils";

const COR_STATUS_MENSAGEM: Record<StatusMensagem, string> = {
  pendente: "border-amber-300 bg-amber-50 text-amber-900",
  enviando: "border-sky-300 bg-sky-50 text-sky-900",
  enviada: "border-emerald-300 bg-emerald-50 text-emerald-900",
  falhou: "border-destructive/40 bg-destructive/10 text-destructive",
  cancelada: "border-muted-foreground/30 bg-muted text-muted-foreground",
};

/** Filtros da fila: formulário GET (funciona sem JavaScript e fica no link). */
export function FiltrosFila({ filtro }: { filtro: FiltroFila }) {
  return (
    <form
      method="get"
      action="/mensagens"
      className="grid gap-3 rounded-xl border bg-card p-4 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_2fr_auto] lg:items-end"
    >
      <input type="hidden" name="aba" value="fila" />
      <div className="flex flex-col gap-2">
        <Label htmlFor="fila-status">Status</Label>
        <Select id="fila-status" name="status" defaultValue={filtro.status ?? ""}>
          <option value="">Todos</option>
          {Object.entries(ROTULO_STATUS_MENSAGEM).map(([v, r]) => (
            <option key={v} value={v}>
              {r}
            </option>
          ))}
        </Select>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="fila-tipo">Tipo</Label>
        <Select id="fila-tipo" name="tipo" defaultValue={filtro.tipo ?? ""}>
          <option value="">Todos</option>
          {Object.entries(ROTULO_TIPO_MENSAGEM).map(([v, r]) => (
            <option key={v} value={v}>
              {r}
            </option>
          ))}
        </Select>
      </div>
      <div className="flex flex-col gap-2 sm:col-span-2 lg:col-span-1">
        <Label htmlFor="fila-busca">Cliente</Label>
        <Input
          id="fila-busca"
          name="busca"
          type="search"
          defaultValue={filtro.busca ?? ""}
          placeholder="Nome ou WhatsApp"
        />
      </div>
      <Button type="submit" variant="secondary" className="sm:col-span-2 lg:col-span-1">
        Filtrar
      </Button>
    </form>
  );
}

export function ListaFila({ itens }: { itens: ItemFila[] }) {
  if (itens.length === 0) {
    return <p className="text-sm text-muted-foreground">Nenhuma mensagem encontrada.</p>;
  }
  return (
    <ul className="flex flex-col gap-3">
      {itens.map((m) => (
        <ItemDaFila key={m.id} m={m} />
      ))}
    </ul>
  );
}

function ItemDaFila({ m }: { m: ItemFila }) {
  const [pendente, iniciar] = useTransition();
  const [confirmando, setConfirmando] = useState(false);

  function cancelar() {
    if (!confirmando) {
      setConfirmando(true);
      return;
    }
    iniciar(async () => {
      const r = await cancelarMensagem({ id: m.id });
      setConfirmando(false);
      if (!r.ok) toast.error(r.erro);
      else toast.success("Mensagem cancelada.");
    });
  }

  function reenviar() {
    iniciar(async () => {
      const r = await reenviarMensagem(m.id);
      if (!r.ok) toast.error(r.erro);
      else toast.success("Mensagem enviada para a fila de novo.");
    });
  }

  const quando =
    m.status === "enviada" && m.enviadaEm
      ? `Enviada em ${formatarNoFuso(m.enviadaEm, "dd/MM 'às' HH:mm")}`
      : `Agendada para ${formatarNoFuso(m.agendadoPara, "dd/MM 'às' HH:mm")}`;

  return (
    <li
      data-testid="item-fila"
      className="flex flex-col gap-3 rounded-xl border bg-card p-4 shadow-sm sm:flex-row sm:items-start"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          {m.clienteId ? (
            <Link
              href={`/clientes/${m.clienteId}`}
              className="font-medium text-ouro-escuro underline-offset-4 hover:underline"
            >
              {m.clienteNome ?? "Cliente"}
            </Link>
          ) : (
            <span className="font-medium">Pedido online</span>
          )}
          <span className="text-muted-foreground tabular-nums">{formatarTelefone(m.telefone)}</span>
          <Badge variant="outline">{ROTULO_TIPO_MENSAGEM[m.tipo]}</Badge>
          <Badge variant="outline" className={cn(COR_STATUS_MENSAGEM[m.status])}>
            {ROTULO_STATUS_MENSAGEM[m.status]}
          </Badge>
        </div>
        <span className="text-xs text-muted-foreground tabular-nums">
          {quando}
          {m.tentativas > 0 && m.status !== "enviada" ? ` · ${m.tentativas} tentativa(s)` : ""}
        </span>
        {m.texto ? (
          <p className="break-words whitespace-pre-line">{m.texto}</p>
        ) : (
          <p className="text-muted-foreground italic">O texto é montado na hora do envio, a partir do modelo.</p>
        )}
        {m.status === "falhou" && m.erro && (
          <p className="text-xs text-destructive">Erro: {m.erro}</p>
        )}
        {m.status === "cancelada" && m.canceladaMotivo && (
          <p className="text-xs text-muted-foreground">Motivo: {m.canceladaMotivo}</p>
        )}
      </div>

      {m.status === "pendente" && (
        <div className="flex flex-wrap gap-2">
          {confirmando && (
            <Button type="button" variant="outline" disabled={pendente} onClick={() => setConfirmando(false)}>
              Voltar
            </Button>
          )}
          <Button type="button" variant="destructive" disabled={pendente} onClick={cancelar}>
            <X aria-hidden />
            {confirmando ? "Confirmar cancelamento" : "Cancelar"}
          </Button>
        </div>
      )}
      {(m.status === "falhou" || m.status === "cancelada") && (
        <Button type="button" variant="outline" disabled={pendente} onClick={reenviar}>
          <RotateCcw aria-hidden />
          Tentar de novo
        </Button>
      )}
    </li>
  );
}
