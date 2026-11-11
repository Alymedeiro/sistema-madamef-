"use client";

import { MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Descrição do diálogo depois de aprovar/recusar. */
export function descricaoAviso(naFila: boolean): string {
  return naFila
    ? "A cliente recebe a mensagem automática pelo WhatsApp."
    : "Avise a cliente pelo WhatsApp.";
}

/**
 * Aviso à cliente depois de aprovar/recusar. Se a resposta automática entrou
 * na fila (envio ligado e WhatsApp válido), só informa. Senão, mantém o botão
 * manual "Avisar no WhatsApp", que abre o wa.me com a mensagem pronta em nova
 * aba (um link, não window.open depois da action, para o navegador não bloquear).
 */
export function BotaoWhatsApp({
  link,
  mensagem,
  naFila,
}: {
  link: string;
  mensagem: string;
  /** Há uma linha da resposta na fila_mensagens para este pedido. */
  naFila: boolean;
}) {
  if (naFila) {
    return (
      <p role="status" className="flex items-center gap-2 rounded-md border bg-blush p-3 text-sm font-medium">
        <MessageCircle aria-hidden className="size-4 shrink-0 text-ouro-escuro" />
        Mensagem enviada para a fila
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <p className="rounded-md border bg-blush p-3 text-sm whitespace-pre-line">{mensagem}</p>
      <Button asChild size="lg">
        <a href={link} target="_blank" rel="noopener noreferrer">
          <MessageCircle aria-hidden />
          Avisar no WhatsApp
        </a>
      </Button>
    </div>
  );
}
