"use client";

import { useState, useTransition } from "react";
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
import { enviarReativacao } from "@/app/(app)/crm/actions";
import { renderizarMensagem } from "@/lib/dominio/whatsapp";

type Props = {
  aberto: boolean;
  onFechar: () => void;
  /** Quando o envio termina, para a lista limpar a seleção. */
  onConcluir: () => void;
  clienteIds: string[];
  /** Nome completo da primeira cliente selecionada (o texto usa só o primeiro nome). */
  primeiraNome: string;
  variacoes: string[];
  modeloAtivo: boolean;
  clinica: string;
};

/** Mostra o texto do modelo Reativação e a contagem; depois do envio, "X na fila, Y puladas". */
export function DialogoReativacao(props: Props) {
  const { aberto, onFechar } = props;
  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && onFechar()}>
      <DialogContent>{aberto && <Conteudo {...props} />}</DialogContent>
    </Dialog>
  );
}

function Conteudo({
  onFechar,
  onConcluir,
  clienteIds,
  primeiraNome,
  variacoes,
  modeloAtivo,
  clinica,
}: Props) {
  const [pendente, iniciar] = useTransition();
  const [erro, setErro] = useState<string | null>(null);
  const [resultado, setResultado] = useState<{ enfileiradas: number; puladas: number } | null>(null);

  // Exemplo com a primeira variação; no envio o sistema sorteia uma delas.
  const exemplo = renderizarMensagem(variacoes, { nome: primeiraNome, clinica }, () => 0);

  function enviar() {
    setErro(null);
    iniciar(async () => {
      const r = await enviarReativacao(clienteIds);
      if (!r.ok) {
        setErro(r.erro);
        return;
      }
      setResultado({ enfileiradas: r.enfileiradas, puladas: r.puladas });
      onConcluir();
      toast.success("Reativação enviada para a fila.");
    });
  }

  if (resultado) {
    return (
      <>
        <DialogHeader>
          <DialogTitle>Reativação enviada</DialogTitle>
          <DialogDescription>
            Pulamos quem está sem WhatsApp, sem opt-in ou recebeu reativação nos últimos 30 dias.
          </DialogDescription>
        </DialogHeader>
        <p role="status" className="text-base font-medium" data-testid="resultado-reativacao">
          {resultado.enfileiradas} na fila, {resultado.puladas} puladas
        </p>
        <DialogFooter>
          <Button type="button" onClick={onFechar}>
            Fechar
          </Button>
        </DialogFooter>
      </>
    );
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Enviar reativação</DialogTitle>
        <DialogDescription>
          {clienteIds.length} {clienteIds.length === 1 ? "cliente selecionada" : "clientes selecionadas"}.
          As mensagens entram na fila e saem no horário de envio.
        </DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium">Texto do modelo “Reativação”</p>
        <p className="rounded-md border bg-muted p-3 text-sm break-words whitespace-pre-line">{exemplo}</p>
        {variacoes.length > 1 && (
          <p className="text-xs text-muted-foreground">
            Exemplo com a primeira de {variacoes.length} variações; cada cliente recebe uma delas.
          </p>
        )}
        {!modeloAtivo && (
          <p className="text-xs text-destructive">
            Este modelo está desligado em Configurações; as mensagens não serão montadas.
          </p>
        )}
      </div>
      {erro && (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive"
        >
          {erro}
        </p>
      )}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onFechar} disabled={pendente}>
          Cancelar
        </Button>
        <Button type="button" onClick={enviar} disabled={pendente || clienteIds.length === 0}>
          {pendente ? "Enviando…" : `Enviar reativação (${clienteIds.length})`}
        </Button>
      </DialogFooter>
    </>
  );
}
