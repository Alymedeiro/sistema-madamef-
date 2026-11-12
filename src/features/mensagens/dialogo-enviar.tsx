"use client";

import { useId, useState, useTransition } from "react";
import { MessageCircle } from "lucide-react";
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
import { Label } from "@/components/ui/label";
import { enviarWhatsApp } from "@/app/(app)/mensagens/actions";
import {
  LIMITE_TEXTO_AVULSA,
  MENSAGEM_TEXTO_VAZIO,
} from "@/app/(app)/mensagens/schemas";

type Props = {
  clienteId: string;
  clienteNome: string;
  /** Envio a partir do detalhe do agendamento: a mensagem fica ligada a ele. */
  agendamentoId?: string;
  variante?: "default" | "outline" | "secondary";
  tamanho?: "default" | "sm";
};

/** Texto inicial do envio avulso: "Oi, {primeiro nome}! ". */
export function textoInicialAvulsa(nome: string): string {
  const primeiro = nome.trim().split(/\s+/)[0] ?? "";
  return primeiro ? `Oi, ${primeiro}! ` : "Oi! ";
}

/** Botão "Enviar WhatsApp" + diálogo do envio avulso (entra na fila como pendente). */
export function BotaoEnviarWhatsapp({
  clienteId,
  clienteNome,
  agendamentoId,
  variante = "outline",
  tamanho = "default",
}: Props) {
  const [aberto, setAberto] = useState(false);
  return (
    <>
      <Button
        type="button"
        variant={variante}
        size={tamanho}
        onClick={() => setAberto(true)}
      >
        <MessageCircle aria-hidden />
        Enviar WhatsApp
      </Button>
      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent>
          {aberto && (
            <FormularioEnvio
              clienteId={clienteId}
              clienteNome={clienteNome}
              agendamentoId={agendamentoId}
              onFechar={() => setAberto(false)}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function FormularioEnvio({
  clienteId,
  clienteNome,
  agendamentoId,
  onFechar,
}: {
  clienteId: string;
  clienteNome: string;
  agendamentoId?: string;
  onFechar: () => void;
}) {
  const id = useId();
  const [texto, setTexto] = useState(() => textoInicialAvulsa(clienteNome));
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();

  function enviar() {
    if (!texto.trim()) {
      setErro(MENSAGEM_TEXTO_VAZIO);
      return;
    }
    setErro(null);
    iniciar(async () => {
      const r = await enviarWhatsApp({ clienteId, texto, agendamentoId });
      if (!r.ok) {
        setErro(r.erro);
        return;
      }
      toast.success("Mensagem enviada para a fila.");
      onFechar();
    });
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Enviar WhatsApp</DialogTitle>
        <DialogDescription>
          Para {clienteNome}. A mensagem entra na fila e sai pelo número da
          clínica.
        </DialogDescription>
      </DialogHeader>
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          enviar();
        }}
      >
        <div className="flex flex-col gap-2">
          <Label htmlFor={`${id}-texto`}>Mensagem</Label>
          <textarea
            id={`${id}-texto`}
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            rows={6}
            maxLength={LIMITE_TEXTO_AVULSA}
            aria-invalid={!!erro}
            className="min-h-11 w-full rounded-md border border-input bg-card px-3 py-2 text-base shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring aria-invalid:border-destructive md:text-sm"
          />
          <p className="text-xs text-muted-foreground tabular-nums">
            {texto.length}/{LIMITE_TEXTO_AVULSA}
          </p>
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
          <Button
            type="button"
            variant="outline"
            onClick={onFechar}
            disabled={pendente}
          >
            Cancelar
          </Button>
          <Button type="submit" disabled={pendente}>
            {pendente ? "Enviando…" : "Enviar"}
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}
