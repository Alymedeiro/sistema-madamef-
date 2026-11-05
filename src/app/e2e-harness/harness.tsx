"use client";

import { useState } from "react";
import { CampoAssinatura } from "@/features/ficha/campo-assinatura";
import { converterParaJpeg } from "@/features/fotos/converter";
import { MENSAGEM_ARQUIVO_RECUSADO, arquivoDeImagemAceito } from "@/lib/dominio/fotos";

export function Harness() {
  const [assinatura, setAssinatura] = useState<string | null>(null);
  const [resultado, setResultado] = useState("");

  async function escolher(lista: FileList | null) {
    const arquivo = lista?.[0];
    if (!arquivo) return;
    if (!arquivoDeImagemAceito(arquivo)) {
      setResultado(`erro: ${MENSAGEM_ARQUIVO_RECUSADO}`);
      return;
    }
    try {
      const blob = await converterParaJpeg(arquivo);
      const img = await createImageBitmap(blob);
      setResultado(`ok ${blob.type} ${img.width}x${img.height} ${blob.size}`);
      img.close();
    } catch (e) {
      setResultado(`erro: ${e instanceof Error ? e.message : "desconhecido"}`);
    }
  }

  return (
    <main className="mx-auto flex max-w-xl flex-col gap-6 p-4">
      <section aria-label="Assinatura" className="flex flex-col gap-2">
        <h1 className="text-lg font-semibold">Harness de testes</h1>
        <CampoAssinatura onMudar={setAssinatura} />
        <p data-testid="assinatura-estado">{assinatura ? "assinada" : "vazia"}</p>
      </section>
      <section aria-label="Conversor de foto" className="flex flex-col gap-2">
        <label htmlFor="arquivo-harness">Arquivo</label>
        <input id="arquivo-harness" type="file" onChange={(e) => void escolher(e.target.files)} />
        <p data-testid="conversao-resultado">{resultado}</p>
      </section>
    </main>
  );
}
