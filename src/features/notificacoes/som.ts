"use client";

import { planoSom } from "./regras";

// Som sintetizado com a Web Audio API (sem arquivo de áudio). O navegador só
// deixa tocar depois de um gesto na página: o primeiro pointerdown/keydown
// "desbloqueia" o AudioContext.

type JanelaComAudio = Window & { webkitAudioContext?: typeof AudioContext };

let contexto: AudioContext | null = null;
let desbloqueado = false;

function obterContexto(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (contexto) return contexto;
  const Construtor = window.AudioContext ?? (window as JanelaComAudio).webkitAudioContext;
  if (!Construtor) return null;
  try {
    contexto = new Construtor();
  } catch {
    contexto = null;
  }
  return contexto;
}

function desbloquear() {
  desbloqueado = true;
  const ctx = obterContexto();
  if (ctx && ctx.state === "suspended") void ctx.resume().catch(() => {});
}

/** Registra o desbloqueio no primeiro gesto. Devolve a função que remove os listeners. */
export function prepararDesbloqueioAudio(): () => void {
  if (typeof window === "undefined" || desbloqueado) return () => {};
  const aoGesto = () => {
    desbloquear();
    remover();
  };
  const remover = () => {
    window.removeEventListener("pointerdown", aoGesto);
    window.removeEventListener("keydown", aoGesto);
  };
  window.addEventListener("pointerdown", aoGesto);
  window.addEventListener("keydown", aoGesto);
  return remover;
}

/**
 * Toca os dois tons suaves. Sem gesto ainda, não toca (a não ser com
 * `gesto: true`, quando a chamada vem de um clique, como "Testar som").
 */
export function tocarSomSuave(volume: number, opcoes: { gesto?: boolean } = {}): void {
  if (opcoes.gesto) desbloquear();
  if (!desbloqueado) return;
  const ctx = obterContexto();
  if (!ctx) return;
  const { tons, ataque, ganho } = planoSom(volume);
  if (ganho <= 0) return;
  try {
    if (ctx.state === "suspended") void ctx.resume().catch(() => {});
    const t0 = ctx.currentTime + 0.01;
    for (const tom of tons) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      const inicio = t0 + tom.inicio;
      const fim = inicio + tom.duracao;
      osc.type = "sine";
      osc.frequency.setValueAtTime(tom.frequencia, inicio);
      g.gain.setValueAtTime(0.0001, inicio);
      g.gain.linearRampToValueAtTime(ganho, inicio + ataque);
      g.gain.exponentialRampToValueAtTime(0.0001, fim);
      osc.connect(g).connect(ctx.destination);
      osc.start(inicio);
      osc.stop(fim + 0.02);
    }
  } catch {
    // Áudio indisponível: segue sem som.
  }
}
