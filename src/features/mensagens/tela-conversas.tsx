"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { listarConversas, marcarConversaLida } from "@/app/(app)/mensagens/actions";
import type { ResumoConversa } from "@/app/(app)/mensagens/dados";
import type { ClassificacaoResposta } from "@/lib/dominio/whatsapp";
import { cn } from "@/lib/utils";
import { ListaConversas } from "./lista-conversas";
import { ConteudoConversa } from "./painel-conversa";

/** Recarga da lista sem conversa aberta (com conversa aberta, a cada 15 s). */
export const INTERVALO_LISTA_MS = 30_000;
const INTERVALO_LISTA_ABERTA_MS = 15_000;

/** Aba Respostas: lista de conversas e a conversa selecionada (duas colunas no desktop). */
export function TelaConversas({
  iniciais,
  classificacao,
  envioAtivo,
  chaveInicial,
}: {
  iniciais: ResumoConversa[];
  classificacao: ClassificacaoResposta | null;
  envioAtivo: boolean;
  chaveInicial: string | null;
}) {
  const [conversas, setConversas] = useState(iniciais);
  const [aberta, setAberta] = useState<ResumoConversa | null>(
    () => iniciais.find((c) => c.chave === chaveInicial) ?? null,
  );
  const marcadasRef = useRef(new Set<string>());

  // A conversa aberta segue a lista; se ela sair do filtro, mantém a última versão vista.
  const atual = aberta ? (conversas.find((c) => c.chave === aberta.chave) ?? aberta) : null;
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

  const recarregar = useCallback(async () => {
    const res = await listarConversas(classificacao);
    if (res.ok) setConversas(res.conversas);
  }, [classificacao]);

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
    const ids = idsNaoLidos.split(",").filter((id) => !marcadasRef.current.has(id));
    if (ids.length === 0) return;
    ids.forEach((id) => marcadasRef.current.add(id));
    void marcarConversaLida(ids).then((res) => {
      if (!res.ok) {
        ids.forEach((id) => marcadasRef.current.delete(id));
        return;
      }
      setConversas((lista) =>
        lista.map((c) => (c.chave === chaveAtual ? { ...c, naoLidas: 0, idsNaoLidos: [] } : c)),
      );
      setAberta((a) => (a && a.chave === chaveAtual ? { ...a, naoLidas: 0, idsNaoLidos: [] } : a));
    });
  }, [chaveAtual, idsNaoLidos]);

  return (
    <div className="grid gap-4 lg:grid-cols-[360px_minmax(0,1fr)] lg:items-start">
      <div className={cn(atual && "hidden lg:block")}>
        <ListaConversas conversas={conversas} selecionada={chaveAtual} onSelecionar={selecionar} />
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
