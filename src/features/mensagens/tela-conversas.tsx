"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  arquivarConversas,
  desarquivarConversas,
  listarConversas,
  marcarConversaLida,
} from "@/app/(app)/mensagens/actions";
import type { ResumoConversa } from "@/app/(app)/mensagens/dados";
import { cn } from "@/lib/utils";
import type { FiltroConversas } from "./filtro-conversas";
import { ListaConversas } from "./lista-conversas";
import { ConteudoConversa } from "./painel-conversa";

/** Recarga da lista sem conversa aberta (com conversa aberta, a cada 15 s). */
export const INTERVALO_LISTA_MS = 30_000;
const INTERVALO_LISTA_ABERTA_MS = 15_000;

/** Tela de Mensagens: lista de conversas e a conversa selecionada (duas colunas no desktop). */
export function TelaConversas({
  iniciais,
  filtro,
  envioAtivo,
  chaveInicial,
}: {
  iniciais: ResumoConversa[];
  filtro: FiltroConversas;
  envioAtivo: boolean;
  chaveInicial: string | null;
}) {
  const [conversas, setConversas] = useState(iniciais);
  const [aberta, setAberta] = useState<ResumoConversa | null>(
    () => iniciais.find((c) => c.chave === chaveInicial) ?? null,
  );
  const marcadasRef = useRef(new Set<string>());

  // A conversa aberta segue a lista; se ela sair do filtro, mantém a última versão vista.
  const atual = aberta
    ? (conversas.find((c) => c.chave === aberta.chave) ?? aberta)
    : null;
  const chaveAtual = atual?.chave ?? null;

  const selecionar = useCallback((c: ResumoConversa | null) => {
    setAberta(c);
    try {
      const url = new URL(window.location.href);
      if (c) url.searchParams.set("conversa", c.chave);
      else url.searchParams.delete("conversa");
      window.history.replaceState(window.history.state, "", url);
    } catch {
      // Sem histórico (ambiente restrito): a seleção só não sobrevive ao refresh.
    }
  }, []);

  // Enquanto uma (des)arquivação está em andamento, a recarga espera (não traz a conversa de volta).
  const pendentesRef = useRef(0);

  const recarregar = useCallback(async () => {
    if (pendentesRef.current > 0) return;
    const res = await listarConversas(filtro);
    if (res.ok && pendentesRef.current === 0) setConversas(res.conversas);
  }, [filtro]);

  const nasArquivadas = filtro.leitura === "arquivadas";

  const desarquivar = useCallback(
    async (chaves: string[], desfazendoArquivar = false) => {
      const anteriores = conversas;
      const saem = new Set(chaves);
      pendentesRef.current += 1;
      if (!desfazendoArquivar)
        setConversas((l) => l.filter((c) => !saem.has(c.chave)));
      const res = await desarquivarConversas(chaves);
      pendentesRef.current -= 1;
      if (!res.ok) {
        toast.error(res.erro);
        if (!desfazendoArquivar) setConversas(anteriores);
        return;
      }
      toast.success(
        chaves.length === 1
          ? "Conversa desarquivada"
          : "Conversas desarquivadas",
      );
      void recarregar();
    },
    [conversas, recarregar],
  );

  const arquivar = useCallback(
    async (chaves: string[]) => {
      const anteriores = conversas;
      const saem = new Set(chaves);
      const doGrupo = conversas.filter((c) => saem.has(c.chave));
      pendentesRef.current += 1;
      setConversas((l) => l.filter((c) => !saem.has(c.chave)));
      if (aberta && saem.has(aberta.chave)) selecionar(null);
      const res = await arquivarConversas(chaves);
      if (!res.ok) {
        pendentesRef.current -= 1;
        toast.error(res.erro);
        setConversas(anteriores);
        return;
      }
      // Recebidas não lidas passam a lidas, para o alerta do Início não ficar aceso.
      const ids = doGrupo
        .flatMap((c) => c.idsNaoLidos)
        .filter((id) => !marcadasRef.current.has(id));
      ids.forEach((id) => marcadasRef.current.add(id));
      if (ids.length > 0) {
        const lidas = await marcarConversaLida(ids);
        if (!lidas.ok) ids.forEach((id) => marcadasRef.current.delete(id));
      }
      pendentesRef.current -= 1;
      toast.success(
        chaves.length === 1
          ? "Conversa arquivada"
          : `${chaves.length} conversas arquivadas`,
        {
          action: {
            label: "Desfazer",
            onClick: () => void desarquivar(chaves, true),
          },
        },
      );
      void recarregar();
    },
    [conversas, aberta, selecionar, desarquivar, recarregar],
  );

  useEffect(() => {
    const t = setInterval(
      () => {
        if (document.visibilityState === "hidden") return;
        void recarregar();
      },
      chaveAtual ? INTERVALO_LISTA_ABERTA_MS : INTERVALO_LISTA_MS,
    );
    return () => clearInterval(t);
  }, [recarregar, chaveAtual]);

  // Abrir uma conversa (ou chegar mensagem nova nela) marca as não lidas como lidas.
  const idsNaoLidos = atual?.idsNaoLidos.join(",") ?? "";
  useEffect(() => {
    if (!chaveAtual || !idsNaoLidos) return;
    const ids = idsNaoLidos
      .split(",")
      .filter((id) => !marcadasRef.current.has(id));
    if (ids.length === 0) return;
    ids.forEach((id) => marcadasRef.current.add(id));
    void marcarConversaLida(ids).then((res) => {
      if (!res.ok) {
        ids.forEach((id) => marcadasRef.current.delete(id));
        return;
      }
      setConversas((lista) =>
        lista.map((c) =>
          c.chave === chaveAtual ? { ...c, naoLidas: 0, idsNaoLidos: [] } : c,
        ),
      );
      setAberta((a) =>
        a && a.chave === chaveAtual
          ? { ...a, naoLidas: 0, idsNaoLidos: [] }
          : a,
      );
    });
    // `conversas` muda a cada recarga: uma marcação que falhou é refeita na próxima.
  }, [chaveAtual, idsNaoLidos, conversas]);

  return (
    <div className="grid gap-4 lg:grid-cols-[360px_minmax(0,1fr)] lg:items-start">
      <div className={cn(atual && "hidden lg:block")}>
        <ListaConversas
          conversas={conversas}
          selecionada={chaveAtual}
          onSelecionar={selecionar}
          arquivadas={nasArquivadas}
          onArquivar={(c) => void arquivar(c)}
          onDesarquivar={(c) => void desarquivar(c)}
        />
      </div>

      {atual ? (
        <section
          aria-label="Conversa"
          className="fixed inset-0 z-50 bg-background lg:static lg:z-auto lg:h-[calc(100dvh-14rem)] lg:min-h-96 lg:overflow-hidden lg:rounded-xl lg:border lg:shadow-sm"
        >
          <ConteudoConversa
            key={atual.chave}
            conversa={atual}
            envioAtivo={envioAtivo}
            onVoltar={() => selecionar(null)}
          />
        </section>
      ) : (
        <p className="hidden rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground lg:block">
          Selecione uma conversa
        </p>
      )}
    </div>
  );
}
