"use client";

import { useCallback, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { arquivarFoto, urlsFotos } from "@/app/(app)/clientes/ficha/fotos";
import type { FotoFicha } from "@/app/(app)/clientes/ficha/dados";
import { ROTULO_TIPO_FOTO, agruparFotos } from "@/lib/dominio/fotos";
import { formatarNoFuso } from "@/lib/dominio/tempo";
import { cn } from "@/lib/utils";
import { CompararFotos } from "./comparar-fotos";

export function GaleriaFotos({
  fotos,
  podeArquivar,
}: {
  fotos: FotoFicha[];
  podeArquivar: boolean;
}) {
  const router = useRouter();
  const [urls, setUrls] = useState<Record<string, string>>(() =>
    Object.fromEntries(fotos.map((f) => [f.id, f.url])),
  );
  const [aberta, setAberta] = useState<FotoFicha | null>(null);
  const [comparando, setComparando] = useState(false);
  const [escolhidas, setEscolhidas] = useState<string[]>([]);
  const [vendoComparacao, setVendoComparacao] = useState(false);
  const [confirmando, setConfirmando] = useState<FotoFicha | null>(null);
  const [pendente, iniciar] = useTransition();
  const renovando = useRef(false);

  const grupos = useMemo(() => agruparFotos(fotos), [fotos]);

  /** URL vencida (a imagem falhou): pede novas URLs assinadas, uma renovação por vez. */
  const renovar = useCallback(async () => {
    if (renovando.current) return;
    renovando.current = true;
    try {
      const r = await urlsFotos(fotos.map((f) => f.id).slice(0, 60));
      if (r.ok) setUrls((u) => ({ ...u, ...r.urls }));
      else toast.error(r.erro);
    } finally {
      // Evita laço de renovações se a imagem continuar falhando.
      setTimeout(() => (renovando.current = false), 5000);
    }
  }, [fotos]);

  function tocar(f: FotoFicha) {
    if (!comparando) return setAberta(f);
    setEscolhidas((e) =>
      e.includes(f.id) ? e.filter((x) => x !== f.id) : e.length >= 2 ? [e[1], f.id] : [...e, f.id],
    );
  }

  function sairDaComparacao() {
    setComparando(false);
    setEscolhidas([]);
    setVendoComparacao(false);
  }

  const par = escolhidas.map((id) => fotos.find((f) => f.id === id)).filter(Boolean) as FotoFicha[];

  if (fotos.length === 0) {
    return <p className="rounded-xl border bg-card p-4 text-muted-foreground">Nenhuma foto ainda.</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        {comparando ? (
          <>
            <Button
              type="button"
              disabled={par.length !== 2}
              onClick={() => setVendoComparacao(true)}
            >
              Ver lado a lado
            </Button>
            <Button type="button" variant="outline" onClick={sairDaComparacao}>
              Cancelar
            </Button>
            <span className="text-sm text-muted-foreground" role="status">
              Escolha duas fotos ({par.length} de 2)
            </span>
          </>
        ) : fotos.length >= 2 ? (
          <Button type="button" variant="outline" onClick={() => setComparando(true)}>
            Comparar
          </Button>
        ) : null}
      </div>

      {grupos.map((g) => (
        <section
          key={`${g.data}|${g.servicoNome ?? ""}`}
          aria-label={`Fotos de ${formatarNoFuso(g.data + "T12:00:00-03:00", "dd/MM/yyyy")}`}
          className="flex flex-col gap-2"
        >
          <h3 className="font-medium">
            {formatarNoFuso(g.data + "T12:00:00-03:00", "dd/MM/yyyy")}
            {g.servicoNome ? ` · ${g.servicoNome}` : ""}
          </h3>
          <ul className="grid grid-cols-2 gap-2 min-[640px]:grid-cols-3 lg:grid-cols-4">
            {g.fotos.map((f) => {
              const marcada = escolhidas.includes(f.id);
              return (
                <li key={f.id}>
                  <button
                    type="button"
                    onClick={() => tocar(f)}
                    aria-pressed={comparando ? marcada : undefined}
                    aria-label={`${ROTULO_TIPO_FOTO[f.tipo]}, ${formatarNoFuso(f.tiradaEm, "dd/MM/yyyy HH:mm")}`}
                    className={cn(
                      "relative block min-h-11 w-full overflow-hidden rounded-lg border-2 border-transparent bg-muted outline-none focus-visible:ring-[3px] focus-visible:ring-ring",
                      marcada && "border-primary",
                    )}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element -- URL assinada temporária (5 min) */}
                    <img
                      src={urls[f.id] ?? f.url}
                      alt=""
                      loading="lazy"
                      className="aspect-square w-full object-cover"
                      onError={renovar}
                    />
                    <Badge className="absolute bottom-1 left-1" variant="secondary">
                      {ROTULO_TIPO_FOTO[f.tipo]}
                    </Badge>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      <Dialog open={!!aberta} onOpenChange={(o) => !o && setAberta(null)}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>
              {aberta ? ROTULO_TIPO_FOTO[aberta.tipo] : ""}
              {aberta ? ` · ${formatarNoFuso(aberta.tiradaEm, "dd/MM/yyyy HH:mm")}` : ""}
            </DialogTitle>
            <DialogDescription>{aberta?.servicoNome ?? "Sem serviço informado"}</DialogDescription>
          </DialogHeader>
          {aberta ? (
            // eslint-disable-next-line @next/next/no-img-element -- URL assinada temporária (5 min)
            <img
              src={urls[aberta.id] ?? aberta.url}
              alt={`${ROTULO_TIPO_FOTO[aberta.tipo]}, ${formatarNoFuso(aberta.tiradaEm, "dd/MM/yyyy")}`}
              className="max-h-[70dvh] w-full rounded-lg bg-muted object-contain"
              onError={renovar}
            />
          ) : null}
          {podeArquivar && aberta ? (
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setConfirmando(aberta);
                  setAberta(null);
                }}
              >
                Arquivar
              </Button>
            </DialogFooter>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={vendoComparacao && par.length === 2} onOpenChange={(o) => !o && setVendoComparacao(false)}>
        <DialogContent className="max-w-5xl">
          <DialogHeader>
            <DialogTitle>Comparar fotos</DialogTitle>
            <DialogDescription>As duas fotos escolhidas, lado a lado.</DialogDescription>
          </DialogHeader>
          {par.length === 2 ? (
            <CompararFotos fotos={[par[0], par[1]]} urls={urls} aoFalharImagem={renovar} />
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={!!confirmando} onOpenChange={(o) => !o && setConfirmando(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Arquivar esta foto?</DialogTitle>
            <DialogDescription>
              Ela sai da galeria e só a dona poderá vê-la depois. Nenhuma foto é apagada.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setConfirmando(null)}>
              Cancelar
            </Button>
            <Button
              type="button"
              disabled={pendente}
              onClick={() =>
                confirmando &&
                iniciar(async () => {
                  const r = await arquivarFoto(confirmando.id);
                  if (r.ok) {
                    toast.success("Foto arquivada.");
                    setConfirmando(null);
                    router.refresh();
                  } else toast.error(r.erro);
                })
              }
            >
              Arquivar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
