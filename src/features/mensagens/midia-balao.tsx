"use client";

import { useState } from "react";
import { Download, FileText } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import type { MidiaConversa } from "@/app/(app)/mensagens/dados";
import { avisoMidia, formatarTamanho, urlBaixar } from "./conversa";

const ROTULO: Record<MidiaConversa["tipo"], string> = {
  imagem: "Foto",
  figurinha: "Figurinha",
  video: "Vídeo",
  audio: "Áudio",
  documento: "Documento",
};

/** Conteúdo de mídia de um balão recebido (a legenda vem logo abaixo). */
export function MidiaBalao({ midia }: { midia: MidiaConversa }) {
  const [aberta, setAberta] = useState(false);
  const aviso = avisoMidia(midia);
  const legenda = midia.legenda ? (
    <p className="mt-1 break-words whitespace-pre-line">{midia.legenda}</p>
  ) : null;

  if (aviso || !midia.url) {
    return (
      <div data-testid="midia" data-status={midia.status}>
        <p className="text-sm text-muted-foreground italic" role={midia.status === "pendente" ? "status" : undefined}>
          <span className="not-italic">{ROTULO[midia.tipo]}: </span>
          {aviso}
        </p>
        {legenda}
      </div>
    );
  }
  const url = midia.url;

  if (midia.tipo === "imagem" || midia.tipo === "figurinha") {
    const figurinha = midia.tipo === "figurinha";
    return (
      <div data-testid="midia" data-status={midia.status}>
        <button
          type="button"
          onClick={() => setAberta(true)}
          aria-label={`Abrir ${ROTULO[midia.tipo].toLowerCase()} em tamanho grande`}
          className="block rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring"
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- URL assinada temporária (10 min) */}
          <img
            src={url}
            alt=""
            loading="lazy"
            className={
              figurinha
                ? "max-h-[160px] max-w-[160px] object-contain"
                : "max-h-[240px] max-w-[240px] rounded-md object-cover"
            }
          />
        </button>
        {legenda}
        <Dialog open={aberta} onOpenChange={setAberta}>
          <DialogContent className="max-w-[min(56rem,calc(100%-2rem))] p-3 pt-12">
            <DialogTitle className="sr-only">{ROTULO[midia.tipo]}</DialogTitle>
            {/* eslint-disable-next-line @next/next/no-img-element -- URL assinada temporária (10 min) */}
            <img src={url} alt="" className="mx-auto max-h-[calc(100dvh-8rem)] w-auto object-contain" />
            {midia.legenda && (
              <p className="text-sm break-words whitespace-pre-line">{midia.legenda}</p>
            )}
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  if (midia.tipo === "video") {
    return (
      <div data-testid="midia" data-status={midia.status}>
        <video controls preload="metadata" src={url} className="max-h-[320px] w-full max-w-[320px] rounded-md bg-black">
          <track kind="captions" />
        </video>
        {legenda}
      </div>
    );
  }

  if (midia.tipo === "audio") {
    return (
      <div data-testid="midia" data-status={midia.status}>
        <audio controls preload="metadata" src={url} className="w-64 max-w-full" />
        {legenda}
      </div>
    );
  }

  const tamanho = formatarTamanho(midia.tamanho);
  return (
    <div data-testid="midia" data-status={midia.status}>
      <div className="flex items-center gap-3 rounded-md border bg-muted/40 p-2">
        <FileText className="size-8 shrink-0 text-muted-foreground" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{midia.nome ?? "Documento"}</p>
          {tamanho && <p className="text-xs text-muted-foreground tabular-nums">{tamanho}</p>}
        </div>
        <a
          href={urlBaixar(url, midia.nome)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-11 shrink-0 items-center gap-1 px-2 text-sm font-medium text-ouro-escuro underline-offset-4 hover:underline"
        >
          <Download className="size-4" aria-hidden />
          Baixar
        </a>
      </div>
      {legenda}
    </div>
  );
}
