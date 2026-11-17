"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, ImagePlus, Loader2, Star, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import {
  registrarFotoServico,
  removerFotoServico,
  reordenarFotosServico,
} from "@/app/(app)/servicos/fotos";
import {
  BUCKET_SERVICOS_FOTOS,
  MAX_FOTOS_SERVICO,
  caminhoFotoServico,
  ordemComCapa,
  ordemMovida,
  rotuloContagemFotos,
  vagasFotos,
} from "@/lib/dominio/servicos-fotos";
import { createBrowserClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { prepararFotoServico } from "./preparar-foto";

export type FotoServicoTela = {
  id: string;
  url: string;
  largura: number | null;
  altura: number | null;
};

const FALHA_ENVIO = "Não foi possível enviar a foto. Tente novamente.";

/** Fotos do serviço (só a dona; só com o serviço já salvo). Ordem 0 = capa. */
export function SecaoFotosServico({
  servicoId,
  nomeServico,
  fotos,
}: {
  servicoId: string;
  nomeServico: string;
  fotos: FotoServicoTela[];
}) {
  const router = useRouter();
  const entrada = useRef<HTMLInputElement>(null);
  const [enviando, setEnviando] = useState<{ atual: number; total: number } | null>(null);
  const [ocupadas, setOcupadas] = useState<Set<string>>(new Set());
  const [remover, setRemover] = useState<FotoServicoTela | null>(null);

  const ids = fotos.map((f) => f.id);
  const vagas = vagasFotos(fotos.length);
  const algumaOcupada = ocupadas.size > 0 || enviando !== null;

  function marcar(lista: string[], ocupada: boolean) {
    setOcupadas((atual) => {
      const nova = new Set(atual);
      for (const id of lista) {
        if (ocupada) nova.add(id);
        else nova.delete(id);
      }
      return nova;
    });
  }

  async function enviar(lista: FileList | null) {
    const arquivos = Array.from(lista ?? []);
    if (entrada.current) entrada.current.value = "";
    if (arquivos.length === 0) return;
    if (arquivos.length > vagas) {
      toast.error(
        vagas === 0
          ? `Cada serviço pode ter no máximo ${MAX_FOTOS_SERVICO} fotos.`
          : `Só cabem mais ${vagas} ${vagas === 1 ? "foto" : "fotos"}. As demais não foram enviadas.`,
      );
    }
    const escolhidos = arquivos.slice(0, vagas);
    if (escolhidos.length === 0) return;

    const supabase = createBrowserClient();
    let enviadas = 0;
    try {
      for (const [i, arquivo] of escolhidos.entries()) {
        setEnviando({ atual: i + 1, total: escolhidos.length });
        try {
          const foto = await prepararFotoServico(arquivo);
          const caminho = caminhoFotoServico(servicoId, crypto.randomUUID(), foto.ext);
          const { error } = await supabase.storage
            .from(BUCKET_SERVICOS_FOTOS)
            .upload(caminho, foto.blob, { contentType: foto.contentType, upsert: false });
          if (error) throw new Error(FALHA_ENVIO);
          const r = await registrarFotoServico({
            servicoId,
            caminho,
            largura: foto.largura,
            altura: foto.altura,
          });
          if (!r.ok) throw new Error(r.erro);
          enviadas++;
        } catch (e) {
          toast.error(`${arquivo.name}: ${e instanceof Error ? e.message : FALHA_ENVIO}`);
        }
      }
    } finally {
      setEnviando(null);
    }
    if (enviadas > 0) {
      toast.success(enviadas === 1 ? "Foto adicionada." : `${enviadas} fotos adicionadas.`);
      router.refresh();
    }
  }

  async function reordenar(nova: string[], afetadas: string[], sucesso: string) {
    if (nova.join() === ids.join()) return;
    marcar(afetadas, true);
    try {
      const r = await reordenarFotosServico(servicoId, nova);
      if (r.ok) {
        toast.success(sucesso);
        router.refresh();
      } else toast.error(r.erro);
    } finally {
      marcar(afetadas, false);
    }
  }

  async function confirmarRemocao() {
    const foto = remover;
    if (!foto) return;
    setRemover(null);
    marcar([foto.id], true);
    try {
      const r = await removerFotoServico(foto.id);
      if (r.ok) {
        toast.success("Foto removida.");
        router.refresh();
      } else toast.error(r.erro);
    } finally {
      marcar([foto.id], false);
    }
  }

  return (
    <section className="flex max-w-3xl flex-col gap-4" aria-labelledby="titulo-fotos-servico">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 id="titulo-fotos-servico" className="font-titulo text-lg font-semibold text-ouro-escuro">
            Fotos
          </h2>
          <p className="text-sm text-muted-foreground">
            {rotuloContagemFotos(fotos.length)}. A primeira é a capa no agendamento online.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          disabled={vagas === 0 || algumaOcupada}
          onClick={() => entrada.current?.click()}
        >
          {enviando ? <Loader2 className="animate-spin" aria-hidden /> : <ImagePlus aria-hidden />}
          Adicionar fotos
        </Button>
        <input
          ref={entrada}
          type="file"
          accept="image/*"
          multiple
          className="sr-only"
          tabIndex={-1}
          aria-label="Escolher fotos do serviço"
          onChange={(e) => void enviar(e.target.files)}
        />
      </div>

      {enviando ? (
        <p role="status" className="text-sm text-muted-foreground">
          {`Enviando foto ${enviando.atual} de ${enviando.total}…`}
        </p>
      ) : null}

      {fotos.length === 0 && !enviando ? (
        <p className="text-sm text-muted-foreground">Nenhuma foto. Adicione até {MAX_FOTOS_SERVICO}.</p>
      ) : (
        <ul className="grid grid-cols-1 gap-4 min-[420px]:grid-cols-2 lg:grid-cols-3">
          {fotos.map((f, i) => {
            const ocupada = ocupadas.has(f.id);
            const rotulo = `foto ${i + 1} de ${nomeServico}`;
            return (
              <li
                key={f.id}
                aria-busy={ocupada}
                className={cn("flex flex-col gap-2 rounded-lg border bg-card p-2", ocupada && "opacity-60")}
              >
                <div className="relative overflow-hidden rounded-md bg-muted">
                  {/* eslint-disable-next-line @next/next/no-img-element -- Storage sem next/image configurado */}
                  <img
                    src={f.url}
                    alt={i === 0 ? `Capa de ${nomeServico}` : `Foto ${i + 1} de ${nomeServico}`}
                    width={f.largura ?? 400}
                    height={f.altura ?? 300}
                    loading="lazy"
                    className="aspect-[4/3] w-full object-cover"
                  />
                  {i === 0 ? (
                    <Badge className="absolute top-2 left-2">
                      <Star aria-hidden />
                      Capa
                    </Badge>
                  ) : null}
                  {ocupada ? (
                    <span className="absolute inset-0 flex items-center justify-center bg-background/50">
                      <Loader2 className="size-6 animate-spin" aria-label="Salvando" />
                    </span>
                  ) : null}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    size="icon"
                    variant="outline"
                    disabled={i === 0 || algumaOcupada}
                    aria-label={`Mover ${rotulo} para a esquerda`}
                    onClick={() =>
                      void reordenar(ordemMovida(ids, f.id, -1), [f.id, ids[i - 1]], "Ordem atualizada.")
                    }
                  >
                    <ArrowLeft aria-hidden />
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="outline"
                    disabled={i === fotos.length - 1 || algumaOcupada}
                    aria-label={`Mover ${rotulo} para a direita`}
                    onClick={() =>
                      void reordenar(ordemMovida(ids, f.id, 1), [f.id, ids[i + 1]], "Ordem atualizada.")
                    }
                  >
                    <ArrowRight aria-hidden />
                  </Button>
                  {i > 0 ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={algumaOcupada}
                      onClick={() => void reordenar(ordemComCapa(ids, f.id), [f.id], "Capa atualizada.")}
                    >
                      Tornar capa<span className="sr-only"> a {rotulo}</span>
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    size="icon"
                    variant="outline"
                    className="ml-auto"
                    disabled={algumaOcupada}
                    aria-label={`Remover ${rotulo}`}
                    onClick={() => setRemover(f)}
                  >
                    <Trash2 aria-hidden />
                  </Button>
                </div>
              </li>
            );
          })}
          {enviando
            ? Array.from({ length: enviando.total - enviando.atual + 1 }, (_, k) => (
                <li key={`enviando-${k}`} aria-hidden className="rounded-lg border bg-card p-2">
                  <Skeleton className="aspect-[4/3] w-full" />
                </li>
              ))
            : null}
        </ul>
      )}

      <Dialog open={remover !== null} onOpenChange={(aberto) => !aberto && setRemover(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remover esta foto?</DialogTitle>
            <DialogDescription>
              A foto sai do cadastro e do agendamento online. Não dá para desfazer.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancelar
              </Button>
            </DialogClose>
            <Button type="button" variant="destructive" onClick={() => void confirmarRemocao()}>
              Remover
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
