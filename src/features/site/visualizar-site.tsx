"use client";

import { useState } from "react";
import { Copy, ExternalLink, Monitor, RotateCw, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Endereço do site institucional da clínica. */
export const SITE_CLINICA = "https://madamefebeauty.com/";

type Modo = "computador" | "celular";

/** Mostra o site da clínica dentro do sistema, só para conferir. */
export function VisualizarSite({ url }: { url: string }) {
  const [modo, setModo] = useState<Modo>("computador");
  const [versao, setVersao] = useState(0);

  async function copiar() {
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Link copiado.");
    } catch {
      toast.error("Não foi possível copiar. Selecione o link e copie manualmente.");
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 truncate rounded-md border bg-card px-3 py-2 text-sm" title={url}>
          {url.replace(/^https?:\/\//, "").replace(/\/$/, "")}
        </span>
        <Button asChild>
          <a href={url} target="_blank" rel="noopener noreferrer">
            <ExternalLink aria-hidden />
            Abrir em nova aba
          </a>
        </Button>
        <Button type="button" variant="outline" onClick={copiar}>
          <Copy aria-hidden />
          Copiar link
        </Button>
        <Button type="button" variant="outline" onClick={() => setVersao((v) => v + 1)}>
          <RotateCw aria-hidden />
          Recarregar
        </Button>
        <div role="group" aria-label="Tamanho da tela" className="flex gap-1 rounded-md border p-1">
          {(
            [
              ["computador", "Computador", Monitor],
              ["celular", "Celular", Smartphone],
            ] as const
          ).map(([valor, rotulo, Icone]) => (
            <Button
              key={valor}
              type="button"
              size="sm"
              variant={modo === valor ? "secondary" : "ghost"}
              aria-pressed={modo === valor}
              onClick={() => setModo(valor)}
              className="min-h-9"
            >
              <Icone aria-hidden />
              {rotulo}
            </Button>
          ))}
        </div>
      </div>

      <p className="text-sm text-muted-foreground">
        Só para visualizar. Para alterar o conteúdo, use o painel onde o site é editado. Se a
        página ficar em branco, clique em &quot;Abrir em nova aba&quot;.
      </p>

      <div className="flex justify-center rounded-xl border bg-muted/40 p-2">
        <iframe
          key={versao}
          src={url}
          title="Site da clínica"
          loading="lazy"
          referrerPolicy="no-referrer"
          sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-forms"
          className={cn(
            "h-[70vh] min-h-[480px] rounded-lg border bg-white",
            modo === "celular" ? "w-full max-w-[390px]" : "w-full",
          )}
        />
      </div>
    </div>
  );
}
