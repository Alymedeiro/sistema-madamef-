"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { rotuloServico, type ServicoOnline } from "./tipos";

/**
 * Detalhes do serviço antes de escolher profissional e horário: galeria com
 * rolagem horizontal (snap) e pontos, nome, duração e descrição. O preço não
 * aparece no /agendar (regra de antes, mantida). Sem foto: só os detalhes.
 */
export function PassoDetalhes({
  servico,
  aoAgendar,
  aoVoltar,
}: {
  servico: ServicoOnline;
  aoAgendar: () => void;
  aoVoltar: () => void;
}) {
  const titulo = useRef<HTMLHeadingElement>(null);
  const trilho = useRef<HTMLDivElement>(null);
  const [atual, setAtual] = useState(0);
  const { fotos } = servico;

  useEffect(() => {
    titulo.current?.focus();
  }, []);

  function aoRolar() {
    const t = trilho.current;
    if (!t || t.clientWidth === 0) return;
    setAtual(Math.min(fotos.length - 1, Math.max(0, Math.round(t.scrollLeft / t.clientWidth))));
  }

  function irPara(i: number) {
    const t = trilho.current;
    if (!t) return;
    t.scrollTo({ left: i * t.clientWidth, behavior: "smooth" });
    setAtual(i);
  }

  return (
    <section className="flex min-w-0 flex-col gap-4" aria-labelledby="titulo-detalhes-servico">
      {fotos.length > 0 ? (
        <div className="flex flex-col gap-2">
          <div
            ref={trilho}
            onScroll={aoRolar}
            className="flex snap-x snap-mandatory overflow-x-auto overscroll-x-contain rounded-lg [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            role="region"
            aria-roledescription="galeria"
            aria-label={`Fotos de ${servico.nome}`}
            tabIndex={0}
          >
            {fotos.map((f, i) => (
              // eslint-disable-next-line @next/next/no-img-element -- Storage sem next/image configurado
              <img
                key={f.url}
                src={f.url}
                alt={fotos.length > 1 ? `${servico.nome} — foto ${i + 1} de ${fotos.length}` : servico.nome}
                width={f.largura ?? 400}
                height={f.altura ?? 300}
                loading={i === 0 ? "eager" : "lazy"}
                className="aspect-[4/3] w-full shrink-0 snap-center bg-muted object-cover"
              />
            ))}
          </div>
          {fotos.length > 1 ? (
            <div className="flex justify-center">
              {fotos.map((f, i) => (
                <button
                  key={f.url}
                  type="button"
                  className="flex size-11 items-center justify-center rounded-full outline-none focus-visible:ring-[3px] focus-visible:ring-ring"
                  aria-label={`Ver foto ${i + 1} de ${fotos.length}`}
                  aria-current={i === atual}
                  onClick={() => irPara(i)}
                >
                  <span
                    aria-hidden
                    className={cn(
                      "size-2.5 rounded-full transition-colors",
                      i === atual ? "bg-primary" : "bg-muted-foreground/40",
                    )}
                  />
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-col gap-1">
        <h2
          id="titulo-detalhes-servico"
          ref={titulo}
          tabIndex={-1}
          className="font-titulo text-xl font-semibold text-ouro-escuro outline-none"
        >
          {rotuloServico(servico)}
        </h2>
        <p className="text-sm text-muted-foreground">Duração: {servico.duracaoMin} min</p>
      </div>
      {servico.descricao ? (
        <p className="text-base whitespace-pre-line break-words">{servico.descricao}</p>
      ) : null}

      <Button type="button" size="lg" onClick={aoAgendar}>
        Agendar este serviço
      </Button>
      <Button type="button" variant="outline" onClick={aoVoltar}>
        Ver outros serviços
      </Button>
    </section>
  );
}
