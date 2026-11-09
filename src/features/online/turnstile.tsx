"use client";

import { useEffect, useRef } from "react";

type Turnstile = {
  render: (
    el: HTMLElement,
    opcoes: {
      sitekey: string;
      language?: string;
      callback: (token: string) => void;
      "expired-callback"?: () => void;
      "error-callback"?: () => void;
    },
  ) => string;
  remove: (id: string) => void;
};

declare global {
  interface Window {
    turnstile?: Turnstile;
  }
}

const SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
let carregando: Promise<Turnstile> | null = null;

/** Carrega o script da Cloudflare uma única vez por página. */
function carregarTurnstile(): Promise<Turnstile> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  carregando ??= new Promise<Turnstile>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = SRC;
    s.async = true;
    s.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error("turnstile")));
    s.onerror = () => {
      carregando = null;
      reject(new Error("turnstile"));
    };
    document.head.appendChild(s);
  });
  return carregando;
}

/**
 * Widget do Cloudflare Turnstile. Sem chave de site (dev/teste) não renderiza
 * nada e o formulário envia token vazio; quem decide é o servidor.
 * Para um token novo (eles valem uma vez), remonte com outra `key`.
 */
export function WidgetTurnstile({
  siteKey,
  aoMudarToken,
  aoFalhar,
}: {
  siteKey: string;
  aoMudarToken: (token: string) => void;
  /** Script não carregou ou o widget deu erro: o formulário avisa para recarregar. */
  aoFalhar: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const callback = useRef(aoMudarToken);
  const falha = useRef(aoFalhar);
  useEffect(() => {
    callback.current = aoMudarToken;
    falha.current = aoFalhar;
  });

  useEffect(() => {
    if (!siteKey || !ref.current) return;
    const el = ref.current;
    let id: string | null = null;
    let ativo = true;
    carregarTurnstile()
      .then((t) => {
        if (!ativo) return;
        id = t.render(el, {
          sitekey: siteKey,
          language: "pt-br",
          callback: (token) => callback.current(token),
          "expired-callback": () => callback.current(""),
          "error-callback": () => {
            callback.current("");
            falha.current();
          },
        });
      })
      .catch(() => {
        if (!ativo) return;
        callback.current("");
        falha.current();
      });
    return () => {
      ativo = false;
      if (id) window.turnstile?.remove(id);
    };
  }, [siteKey]);

  if (!siteKey) return null;
  return <div ref={ref} className="min-h-[65px]" />;
}
