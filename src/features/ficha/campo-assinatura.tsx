"use client";

import { useCallback, useEffect, useRef } from "react";
import SignaturePad from "signature_pad";
import { Button } from "@/components/ui/button";

const ALTURA = 220;

export function CampoAssinatura({
  onMudar,
}: {
  onMudar: (dataUrl: string | null) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const padRef = useRef<SignaturePad | null>(null);
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
    const aoTerminar = () =>
      onMudarRef.current(pad.isEmpty() ? null : pad.toDataURL("image/png"));
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
          onMudar(null);
        }}
      >
        Limpar
      </Button>
    </div>
  );
}
