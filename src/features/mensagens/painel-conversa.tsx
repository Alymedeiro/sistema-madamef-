"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, useTransition } from "react";
import { Ban, Check, Clock, Send, Smile, TriangleAlert, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { buscarConversa, enviarWhatsApp, marcarRespostaLida } from "@/app/(app)/mensagens/actions";
import type { ItemConversa, Resposta } from "@/app/(app)/mensagens/dados";
import { LIMITE_TEXTO_AVULSA } from "@/app/(app)/mensagens/schemas";
import { formatarTelefone } from "@/lib/dominio/telefone";
import { horaNoFuso } from "@/lib/dominio/tempo";
import type { StatusMensagem } from "@/lib/dominio/whatsapp";
import { cn } from "@/lib/utils";
import { enviarResposta, estaPertoDoFim, inserirNoCursor, rotuloDia, textoEnviavel } from "./conversa";
import { SeletorEmoji } from "./seletor-emoji";

/** Recarrega a conversa enquanto o painel está aberto. */
export const INTERVALO_CONVERSA_MS = 15_000;
const CONTADOR_A_PARTIR_DE = 900;

const STATUS_ENVIADA: Record<StatusMensagem, { rotulo: string; Icone: typeof Check }> = {
  pendente: { rotulo: "Na fila", Icone: Clock },
  enviando: { rotulo: "Na fila", Icone: Clock },
  enviada: { rotulo: "Enviada", Icone: Check },
  falhou: { rotulo: "Falhou", Icone: TriangleAlert },
  cancelada: { rotulo: "Cancelada", Icone: Ban },
};

/** Botão "Responder" do cartão + painel lateral com a conversa. */
export function BotaoResponder({ r, envioAtivo }: { r: Resposta; envioAtivo: boolean }) {
  const [aberto, setAberto] = useState(false);
  const semCliente = !r.clienteId;
  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={semCliente}
        title={semCliente ? "Cliente não cadastrada" : undefined}
        onClick={() => setAberto(true)}
      >
        <MessageCircle aria-hidden />
        Responder
      </Button>
      {semCliente && <span className="sr-only">Cliente não cadastrada</span>}
      {r.clienteId && (
        <Dialog open={aberto} onOpenChange={setAberto}>
          <DialogContent
            className="inset-y-0 right-0 left-auto h-dvh max-h-dvh w-full max-w-none translate-x-0 translate-y-0 grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden rounded-none p-0 sm:max-w-md sm:rounded-l-xl"
          >
            {aberto && <Conversa r={r} clienteId={r.clienteId} envioAtivo={envioAtivo} />}
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

function Conversa({ r, clienteId, envioAtivo }: { r: Resposta; clienteId: string; envioAtivo: boolean }) {
  const id = useId();
  const [itens, setItens] = useState<ItemConversa[] | null>(null);
  const [erroCarga, setErroCarga] = useState<string | null>(null);
  const [texto, setTexto] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [emojis, setEmojis] = useState(false);
  const [enviando, iniciar] = useTransition();
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const listaRef = useRef<HTMLDivElement>(null);
  const cursorRef = useRef<number | null>(null);
  const lidaRef = useRef(r.lidaEm !== null);
  // Rola ao abrir e após envio próprio; depois só se já estava a ≤ 80 px do fim.
  const forcarRolagemRef = useRef(true);
  const pertoDoFimRef = useRef(true);

  const carregar = useCallback(async () => {
    const res = await buscarConversa(clienteId);
    if (res.ok) {
      setItens(res.itens);
      setErroCarga(null);
    } else {
      setErroCarga(res.erro);
    }
  }, [clienteId]);

  useEffect(() => {
    void carregar();
    const t = setInterval(() => {
      if (document.visibilityState === "hidden") return;
      void carregar();
    }, INTERVALO_CONVERSA_MS);
    return () => clearInterval(t);
  }, [carregar]);

  // Rolagem começa no fim e acompanha mensagens novas.
  const ultimo = itens?.[itens.length - 1]?.id;
  const total = itens?.length ?? 0;
  useLayoutEffect(() => {
    const el = listaRef.current;
    if (!el || itens === null) return;
    if (forcarRolagemRef.current || pertoDoFimRef.current) {
      el.scrollTop = el.scrollHeight;
      forcarRolagemRef.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ultimo, total]);

  // Auto-expansível (1 a 5 linhas) e cursor após inserir emoji.
  useLayoutEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
    if (cursorRef.current !== null) {
      el.setSelectionRange(cursorRef.current, cursorRef.current);
      cursorRef.current = null;
    }
  }, [texto]);

  function inserirEmoji(emoji: string) {
    const el = areaRef.current;
    const inicio = el?.selectionStart ?? texto.length;
    const fim = el?.selectionEnd ?? texto.length;
    const novo = inserirNoCursor(texto, inicio, fim, emoji);
    if (novo.texto.length > LIMITE_TEXTO_AVULSA) return;
    cursorRef.current = novo.cursor;
    setTexto(novo.texto);
    el?.focus();
  }

  function enviar() {
    if (!textoEnviavel(texto) || enviando) return;
    setErro(null);
    iniciar(async () => {
      const res = await enviarResposta(
        { clienteId, texto, respostaId: r.id, jaLida: lidaRef.current },
        { enviar: enviarWhatsApp, marcarLida: marcarRespostaLida },
      );
      if (!res.ok) {
        setErro(res.erro);
        return;
      }
      if (res.lida) lidaRef.current = true;
      forcarRolagemRef.current = true;
      setTexto("");
      setEmojis(false);
      await carregar();
    });
  }

  const agora = new Date();
  let diaAnterior = "";

  return (
    <>
      <DialogHeader className="border-b p-4 pr-14">
        <DialogTitle>Conversa com {r.clienteNome ?? "cliente"}</DialogTitle>
        <DialogDescription className="tabular-nums">{formatarTelefone(r.telefone)}</DialogDescription>
      </DialogHeader>

      <div
        ref={listaRef}
        onScroll={(e) => {
          pertoDoFimRef.current = estaPertoDoFim(e.currentTarget);
        }}
        data-testid="conversa"
        className="flex min-h-0 flex-col gap-1 overflow-y-auto bg-muted/40 p-3"
      >
        {itens === null && !erroCarga && <p className="text-sm text-muted-foreground">Carregando…</p>}
        {erroCarga && (
          <p role="alert" className="text-sm text-destructive">
            {erroCarga}
          </p>
        )}
        {itens?.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma mensagem ainda.</p>}
        {itens?.map((m) => {
          const dia = rotuloDia(m.quando, agora);
          const separador = dia !== diaAnterior;
          diaAnterior = dia;
          return (
            <div key={`${m.direcao}-${m.id}`} className="flex flex-col gap-1">
              {separador && (
                <div className="my-2 self-center rounded-full bg-card px-3 py-1 text-xs text-muted-foreground shadow-sm">
                  {dia}
                </div>
              )}
              <Balao m={m} />
            </div>
          );
        })}
      </div>

      <form
        noValidate
        className="relative flex flex-col gap-2 border-t bg-card p-3"
        onSubmit={(e) => {
          e.preventDefault();
          enviar();
        }}
      >
        {erro && (
          <p
            role="alert"
            className="rounded-md border border-destructive/40 bg-destructive/5 p-2 text-sm text-destructive"
          >
            {erro}
          </p>
        )}
        {emojis && <SeletorEmoji onEscolher={inserirEmoji} onFechar={() => setEmojis(false)} />}
        <div className="flex items-end gap-2">
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="size-11 shrink-0"
            aria-label="Emojis"
            aria-expanded={emojis}
            onClick={() => setEmojis((v) => !v)}
          >
            <Smile aria-hidden />
          </Button>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <label htmlFor={`${id}-texto`} className="sr-only">
              Mensagem
            </label>
            <textarea
              id={`${id}-texto`}
              ref={areaRef}
              value={texto}
              rows={1}
              maxLength={LIMITE_TEXTO_AVULSA}
              placeholder="Escreva a mensagem"
              onChange={(e) => setTexto(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  enviar();
                }
              }}
              className="max-h-[8.5rem] min-h-11 w-full resize-none overflow-y-auto rounded-md border border-input bg-card px-3 py-2.5 text-base leading-6 shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring md:text-sm"
            />
          </div>
          <Button
            type="submit"
            size="icon"
            className="size-11 shrink-0"
            aria-label="Enviar"
            disabled={enviando || !textoEnviavel(texto)}
          >
            <Send aria-hidden />
          </Button>
        </div>
        {texto.length > CONTADOR_A_PARTIR_DE && (
          <p className="text-right text-xs text-muted-foreground tabular-nums">
            {texto.length}/{LIMITE_TEXTO_AVULSA}
          </p>
        )}
        {!envioAtivo && (
          <p className="text-xs text-muted-foreground">
            O envio está desligado em Configurações → WhatsApp; a mensagem fica na fila.
          </p>
        )}
      </form>
    </>
  );
}

function Balao({ m }: { m: ItemConversa }) {
  const enviada = m.direcao === "enviada";
  const status = enviada && m.status ? STATUS_ENVIADA[m.status] : null;
  return (
    <div
      data-testid={enviada ? "balao-enviada" : "balao-recebida"}
      className={cn(
        "max-w-[85%] rounded-lg px-3 py-2 text-sm shadow-sm",
        enviada ? "self-end bg-[#dcf8c6] text-neutral-900" : "self-start bg-card text-card-foreground",
      )}
    >
      <p className="break-words whitespace-pre-line">{m.texto}</p>
      <p
        className={cn(
          "mt-1 flex items-center justify-end gap-1 text-xs tabular-nums",
          enviada ? "text-neutral-600" : "text-muted-foreground",
        )}
      >
        <span>{horaNoFuso(m.quando)}</span>
        {status && (
          <span className="inline-flex items-center gap-1">
            <status.Icone className="size-3.5" aria-hidden />
            {status.rotulo}
          </span>
        )}
      </p>
    </div>
  );
}
