"use client";

import { MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * "Avisar no WhatsApp": abre o wa.me com a mensagem pronta em nova aba. É um
 * link (não window.open depois da action) para o navegador não bloquear.
 */
export function BotaoWhatsApp({ link, mensagem }: { link: string; mensagem: string }) {
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
