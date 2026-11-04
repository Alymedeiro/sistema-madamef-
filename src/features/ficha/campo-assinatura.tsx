"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import SignaturePad from "signature_pad";
import { Button } from "@/components/ui/button";
import { MAX_BYTES_ASSINATURA, bytesDaDataUrl } from "@/lib/ficha/assinatura";

const ALTURA = 220;
/** Largura máxima do PNG exportado: em tablets com DPR 3 o canvas passa de 200 KB. */
const LARGURA_EXPORTADA = 1000;
const ERRO_GRANDE = "Assinatura muito grande. Toque em Limpar e assine novamente.";

/** PNG com fundo branco, reduzido a no máximo LARGURA_EXPORTADA px de largura. */
function exportarReduzido(canvas: HTMLCanvasElement): string {
  const escala = Math.min(1, LARGURA_EXPORTADA / canvas.width);
  const saida = document.createElement("canvas");
  saida.width = Math.max(1, Math.round(canvas.width * escala));
  saida.height = Math.max(1, Math.round(canvas.height * escala));
  const ctx = saida.getContext("2d");
  if (!ctx) return canvas.toDataURL("image/png");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, saida.width, saida.height);
  ctx.drawImage(canvas, 0, 0, saida.width, saida.height);
  return saida.toDataURL("image/png");
}

export function CampoAssinatura({
  onMudar,
}: {
  onMudar: (dataUrl: string | null) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const padRef = useRef<SignaturePad | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const onMudarRef = useRef(onMudar);
  useEffect(() => {
    onMudarRef.current = onMudar;
  }, [onMudar]);

  const ajustar = useCallback(() => {
    const canvas = canvasRef.current;
    const pad = padRef.current;
    if (!canvas || !pad) return;
    const largura = canvas.parentElement?.clientWidth ?? canvas.clientWidth;
    if (!largura) return;
    const razao = Math.max(window.devicePixelRatio || 1, 1);
    const traco = pad.isEmpty() ? null : pad.toData();
    canvas.width = largura * razao;
    canvas.height = ALTURA * razao;
    canvas.style.width = `${largura}px`;
    canvas.style.height = `${ALTURA}px`;
    canvas.getContext("2d")?.scale(razao, razao);
    pad.clear();
    if (traco) pad.fromData(traco);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const pad = new SignaturePad(canvas, { penColor: "#2b2118" });
    padRef.current = pad;
    ajustar();
    const aoTerminar = () => {
      if (pad.isEmpty()) {
        setErro(null);
        onMudarRef.current(null);
        return;
      }
      const png = exportarReduzido(canvas);
      if (bytesDaDataUrl(png) > MAX_BYTES_ASSINATURA) {
        setErro(ERRO_GRANDE);
        onMudarRef.current(null);
        return;
      }
      setErro(null);
      onMudarRef.current(png);
    };
    pad.addEventListener("endStroke", aoTerminar);
    const obs = new ResizeObserver(() => ajustar());
    if (canvas.parentElement) obs.observe(canvas.parentElement);
    return () => {
      obs.disconnect();
      pad.removeEventListener("endStroke", aoTerminar);
      pad.off();
      padRef.current = null;
    };
  }, [ajustar]);

  return (
    <div className="flex flex-col gap-2">
      <div className="w-full overflow-hidden rounded-xl border-2 border-dashed bg-white">
        <canvas
          ref={canvasRef}
          role="img"
          aria-label="Área de assinatura"
          style={{ touchAction: "none", height: ALTURA, display: "block" }}
        />
      </div>
      <Button
        type="button"
        variant="outline"
        className="min-h-11 self-start"
        onClick={() => {
          padRef.current?.clear();
          setErro(null);
          onMudar(null);
        }}
      >
        Limpar
      </Button>
      {erro ? (
        <p role="alert" className="text-sm font-medium text-destructive">
          {erro}
        </p>
      ) : null}
    </div>
  );
}
