"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { salvarModeloTermo } from "@/app/(app)/configuracoes/termos/actions";
import { cn } from "@/lib/utils";

type Props = {
  /** Versão ativa que será substituída; ausente = termo novo. */
  anteriorId?: string;
  titulo?: string;
  texto?: string;
  versao?: number;
};

export function EditorModeloTermo({
  anteriorId,
  titulo: tituloInicial = "",
  texto: textoInicial = "",
  versao,
}: Props) {
  const router = useRouter();
  const id = useId();
  const [titulo, setTitulo] = useState(tituloInicial);
  const [texto, setTexto] = useState(textoInicial);
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();
  const novo = anteriorId === undefined;
  const mudou = novo || titulo.trim() !== tituloInicial || texto.trim() !== textoInicial.trim();

  function salvar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    iniciar(async () => {
      const r = await salvarModeloTermo({ anteriorId: anteriorId ?? null, titulo, texto });
      if (!r.ok) {
        setErro(r.erro);
        toast.error(r.erro);
        return;
      }
      toast.success(novo ? "Termo criado." : "Nova versão salva.");
      if (novo) {
        setTitulo("");
        setTexto("");
      }
      router.refresh();
    });
  }

  return (
    <form onSubmit={salvar} noValidate className="flex flex-col gap-4">
      {versao ? (
        <p className="text-sm text-muted-foreground">
          Versão atual: {versao}. Ao salvar com mudanças, nasce uma nova versão; os termos já
          assinados continuam com o texto em que foram assinados.
        </p>
      ) : null}
      <div className="flex flex-col gap-2">
        <Label htmlFor={`${id}-titulo`}>Título</Label>
        <Input
          id={`${id}-titulo`}
          value={titulo}
          maxLength={120}
          onChange={(e) => setTitulo(e.target.value)}
          autoComplete="off"
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor={`${id}-texto`}>Texto</Label>
        <textarea
          id={`${id}-texto`}
          value={texto}
          rows={12}
          maxLength={20_000}
          onChange={(e) => setTexto(e.target.value)}
          className={cn(
            "flex min-h-48 w-full rounded-md border border-input bg-card px-3 py-2 text-base shadow-xs outline-none md:text-sm",
            "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring",
          )}
        />
        <p className="text-sm text-muted-foreground">
          Use “# ” no começo da linha para um título de seção, “- ” para itens de lista e uma
          linha em branco para separar parágrafos.
        </p>
      </div>
      {erro ? (
        <p role="alert" className="text-sm font-medium text-destructive">
          {erro}
        </p>
      ) : null}
      <Button type="submit" className="self-start" disabled={pendente || !mudou}>
        {pendente ? "Salvando…" : novo ? "Criar termo" : "Salvar nova versão"}
      </Button>
    </form>
  );
}
