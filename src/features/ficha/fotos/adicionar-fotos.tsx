"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { registrarFotos } from "@/app/(app)/clientes/ficha/fotos";
import { converterParaJpeg } from "@/features/fotos/converter";
import {
  MENSAGEM_ARQUIVO_RECUSADO,
  ROTULO_TIPO_FOTO,
  TIPOS_FOTO,
  arquivoDeImagemAceito,
  type TipoFoto,
} from "@/lib/dominio/fotos";
import { BUCKET_FICHA, caminhoArquivo } from "@/lib/ficha/caminhos";
import { createBrowserClient } from "@/lib/supabase/client";

export type AtendimentoOpcao = {
  id: string;
  servicoId: string | null;
  rotulo: string;
};

const MAX_POR_ENVIO = 20;

export function AdicionarFotos({
  clienteId,
  atendimentos,
}: {
  clienteId: string;
  atendimentos: AtendimentoOpcao[];
}) {
  const router = useRouter();
  const [tipo, setTipo] = useState<TipoFoto>("antes");
  const [atendimentoId, setAtendimentoId] = useState("");
  const [progresso, setProgresso] = useState<string | null>(null);
  const camera = useRef<HTMLInputElement>(null);
  const galeria = useRef<HTMLInputElement>(null);
  const ocupado = progresso !== null;

  async function enviar(lista: FileList | null) {
    const arquivos = Array.from(lista ?? []);
    if (camera.current) camera.current.value = "";
    if (galeria.current) galeria.current.value = "";
    if (arquivos.length === 0) return;
    if (arquivos.length > MAX_POR_ENVIO) {
      toast.error(`Escolha até ${MAX_POR_ENVIO} fotos por vez.`);
      return;
    }
    const recusados = arquivos.filter((a) => !arquivoDeImagemAceito(a));
    if (recusados.length > 0) toast.error(MENSAGEM_ARQUIVO_RECUSADO);
    const validos = arquivos.filter(arquivoDeImagemAceito);
    if (validos.length === 0) return;

    const atendimento = atendimentos.find((a) => a.id === atendimentoId);
    const supabase = createBrowserClient();
    const enviadas: string[] = [];
    const tiradaEm = new Date().toISOString();

    for (const [i, arquivo] of validos.entries()) {
      setProgresso(`Enviando foto ${i + 1} de ${validos.length}…`);
      try {
        const blob = await converterParaJpeg(arquivo as File);
        const path = caminhoArquivo(clienteId, "fotos", crypto.randomUUID(), "jpg");
        const { error } = await supabase.storage
          .from(BUCKET_FICHA)
          .upload(path, blob, { contentType: "image/jpeg", upsert: false });
        if (error) throw new Error("Não foi possível enviar a foto. Tente novamente.");
        enviadas.push(path);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Não foi possível enviar a foto.");
      }
    }

    if (enviadas.length > 0) {
      setProgresso("Salvando…");
      const r = await registrarFotos(
        clienteId,
        enviadas.map((path) => ({
          path,
          tipo,
          servicoId: atendimento?.servicoId ?? null,
          agendamentoId: atendimento?.id ?? null,
          tiradaEm,
        })),
      );
      if (r.ok) {
        toast.success(enviadas.length === 1 ? "Foto adicionada." : `${enviadas.length} fotos adicionadas.`);
        router.refresh();
      } else toast.error(r.erro);
    }
    setProgresso(null);
  }

  return (
    <section aria-label="Adicionar fotos" className="flex max-w-2xl flex-col gap-3 rounded-xl border bg-card p-4">
      <h2 className="font-titulo text-lg font-semibold text-ouro-escuro">Adicionar fotos</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="tipo-foto">Tipo</Label>
          <Select
            id="tipo-foto"
            value={tipo}
            disabled={ocupado}
            onChange={(e) => setTipo(e.target.value as TipoFoto)}
          >
            {TIPOS_FOTO.map((t) => (
              <option key={t} value={t}>
                {ROTULO_TIPO_FOTO[t]}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="atendimento-foto">Atendimento (opcional)</Label>
          <Select
            id="atendimento-foto"
            value={atendimentoId}
            disabled={ocupado}
            onChange={(e) => setAtendimentoId(e.target.value)}
          >
            <option value="">Sem atendimento</option>
            {atendimentos.map((a) => (
              <option key={a.id} value={a.id}>
                {a.rotulo}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button type="button" disabled={ocupado} onClick={() => camera.current?.click()}>
          Tirar foto
        </Button>
        <Button type="button" variant="outline" disabled={ocupado} onClick={() => galeria.current?.click()}>
          Galeria
        </Button>
        <input
          ref={camera}
          type="file"
          accept="image/*"
          capture="environment"
          className="sr-only"
          tabIndex={-1}
          aria-label="Tirar foto"
          onChange={(e) => void enviar(e.target.files)}
        />
        <input
          ref={galeria}
          type="file"
          accept="image/*,.heic,.heif"
          multiple
          className="sr-only"
          tabIndex={-1}
          aria-label="Escolher fotos da galeria"
          onChange={(e) => void enviar(e.target.files)}
        />
      </div>
      {progresso ? (
        <p role="status" className="text-sm text-muted-foreground">
          {progresso}
        </p>
      ) : null}
    </section>
  );
}
