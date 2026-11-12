"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useTransition,
} from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Ban,
  Check,
  Clock,
  RotateCcw,
  Send,
  Smile,
  TriangleAlert,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  buscarConversa,
  buscarConversaSemCadastro,
  cancelarMensagem,
  enviarWhatsApp,
  reenviarMensagem,
} from "@/app/(app)/mensagens/actions";
import type { ItemConversa, ResumoConversa } from "@/app/(app)/mensagens/dados";
import { LIMITE_TEXTO_AVULSA } from "@/app/(app)/mensagens/schemas";
import { formatarTelefone } from "@/lib/dominio/telefone";
import { horaNoFuso } from "@/lib/dominio/tempo";
import { ROTULO_TIPO_MENSAGEM, type StatusMensagem } from "@/lib/dominio/whatsapp";
import { cn } from "@/lib/utils";
import {
  cancelarDoBalao,
  estaPertoDoFim,
  inserirNoCursor,
  reenviarDoBalao,
  rotuloAgendada,
  rotuloDia,
  textoEnviavel,
} from "./conversa";
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

/** Conteúdo de uma conversa: cabeçalho, balões, composer e recarga a cada 15 s. */
export function ConteudoConversa({
  conversa,
  envioAtivo,
  onVoltar,
}: {
  conversa: ResumoConversa;
  envioAtivo: boolean;
  onVoltar: () => void;
}) {
  const { clienteId, telefone } = conversa;
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
  // Rola ao abrir e após envio próprio; depois só se já estava a ≤ 80 px do fim.
  const forcarRolagemRef = useRef(true);
  const pertoDoFimRef = useRef(true);

  const carregar = useCallback(async () => {
    const res = clienteId
      ? await buscarConversa(clienteId)
      : await buscarConversaSemCadastro(telefone);
    if (res.ok) {
      setItens(res.itens);
      setErroCarga(null);
    } else {
      setErroCarga(res.erro);
    }
  }, [clienteId, telefone]);

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
    if (!clienteId || !textoEnviavel(texto) || enviando) return;
    setErro(null);
    iniciar(async () => {
      const res = await enviarWhatsApp({ clienteId, texto });
      if (!res.ok) {
        setErro(res.erro);
        return;
      }
      forcarRolagemRef.current = true;
      setTexto("");
      setEmojis(false);
      await carregar();
    });
  }

  const agora = new Date();
  let diaAnterior = "";

  return (
    <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)_auto]">
      <header className="flex items-center gap-2 border-b p-3">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-11 shrink-0 lg:hidden"
          aria-label="Voltar"
          onClick={onVoltar}
        >
          <ArrowLeft aria-hidden />
        </Button>
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-medium">{conversa.nome ?? "Número sem cadastro"}</h2>
          <p className="text-sm text-muted-foreground tabular-nums">{formatarTelefone(telefone)}</p>
        </div>
        {clienteId ? (
          <Link
            href={`/clientes/${clienteId}`}
            className="inline-flex min-h-11 shrink-0 items-center px-2 text-sm font-medium text-ouro-escuro underline-offset-4 hover:underline"
          >
            Abrir ficha
          </Link>
        ) : null}
      </header>

      <div
        ref={listaRef}
        onScroll={(e) => {
          pertoDoFimRef.current = estaPertoDoFim(e.currentTarget);
        }}
        data-testid="conversa"
        className="flex min-h-0 flex-col gap-1 overflow-y-auto bg-muted/40 p-3"
      >
        {itens === null && !erroCarga && (
          <p className="text-sm text-muted-foreground">Carregando…</p>
        )}
        {erroCarga && (
          <p role="alert" className="text-sm text-destructive">
            {erroCarga}
          </p>
        )}
        {itens?.length === 0 && (
          <p className="text-sm text-muted-foreground">Nenhuma mensagem ainda.</p>
        )}
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
              <Balao m={m} onAtualizar={carregar} />
            </div>
          );
        })}
      </div>

      {clienteId ? (
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
      ) : (
        <div className="flex flex-col items-start gap-2 border-t bg-card p-3 text-sm">
          <p>Cadastre a cliente para responder.</p>
          <Button asChild variant="outline">
            <Link href="/clientes">Cadastrar cliente</Link>
          </Button>
        </div>
      )}
    </div>
  );
}

function Balao({ m, onAtualizar }: { m: ItemConversa; onAtualizar: () => Promise<void> }) {
  const [pendente, iniciar] = useTransition();
  const [confirmando, setConfirmando] = useState(false);
  const enviada = m.direcao === "enviada";
  const agendada = enviada ? rotuloAgendada(m) : null;
  const status = enviada && m.status ? STATUS_ENVIADA[m.status] : null;

  function cancelar() {
    if (!confirmando) {
      setConfirmando(true);
      return;
    }
    iniciar(async () => {
      const r = await cancelarDoBalao(m.id, { cancelar: cancelarMensagem });
      setConfirmando(false);
      if (!r.ok) toast.error(r.erro);
      else toast.success("Mensagem cancelada.");
      await onAtualizar();
    });
  }

  function reenviar() {
    iniciar(async () => {
      const r = await reenviarDoBalao(m.id, { reenviar: reenviarMensagem });
      if (!r.ok) toast.error(r.erro);
      else toast.success("Mensagem enviada para a fila de novo.");
      await onAtualizar();
    });
  }

  return (
    <div
      data-testid={enviada ? "balao-enviada" : "balao-recebida"}
      className={cn(
        "max-w-[85%] rounded-lg px-3 py-2 text-sm shadow-sm",
        enviada
          ? "self-end bg-[#dcf8c6] text-neutral-900"
          : "self-start bg-card text-card-foreground",
      )}
    >
      {m.tipo && m.tipo !== "avulsa" && (
        <Badge variant="outline" className="mb-1 border-neutral-400/60 bg-white/60 text-neutral-800">
          {ROTULO_TIPO_MENSAGEM[m.tipo]}
        </Badge>
      )}
      <p className="break-words whitespace-pre-line">{m.texto}</p>
      {m.status === "falhou" && m.erro && (
        <p className="mt-1 text-xs text-destructive">Erro: {m.erro}</p>
      )}
      {m.status === "cancelada" && m.canceladaMotivo && (
        <p className="mt-1 text-xs text-neutral-600">Motivo: {m.canceladaMotivo}</p>
      )}
      <p
        className={cn(
          "mt-1 flex flex-wrap items-center justify-end gap-x-2 gap-y-1 text-xs tabular-nums",
          enviada ? "text-neutral-600" : "text-muted-foreground",
        )}
      >
        {agendada ? (
          <span className="inline-flex items-center gap-1">
            <Clock className="size-3.5" aria-hidden />
            {agendada}
          </span>
        ) : (
          <span>{horaNoFuso(m.quando)}</span>
        )}
        {status && !agendada && (
          <span className="inline-flex items-center gap-1">
            <status.Icone className="size-3.5" aria-hidden />
            {status.rotulo}
          </span>
        )}
      </p>
      {m.status === "pendente" && (
        <div className="mt-2 flex flex-wrap justify-end gap-2">
          {confirmando && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="min-h-11"
              disabled={pendente}
              onClick={() => setConfirmando(false)}
            >
              Voltar
            </Button>
          )}
          <Button
            type="button"
            variant="destructive"
            size="sm"
            className="min-h-11"
            disabled={pendente}
            onClick={cancelar}
          >
            <X aria-hidden />
            {confirmando ? "Confirmar cancelamento" : "Cancelar"}
          </Button>
        </div>
      )}
      {m.status === "falhou" && (
        <div className="mt-2 flex justify-end">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="min-h-11"
            disabled={pendente}
            onClick={reenviar}
          >
            <RotateCcw aria-hidden />
            Tentar de novo
          </Button>
        </div>
      )}
    </div>
  );
}
