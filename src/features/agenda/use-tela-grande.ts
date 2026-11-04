"use client";

import { useSyncExternalStore } from "react";

const CONSULTA = "(min-width: 1024px)";

function assinar(aviso: () => void) {
  const mql = window.matchMedia(CONSULTA);
  mql.addEventListener("change", aviso);
  return () => mql.removeEventListener("change", aviso);
}

/** true em telas ≥ 1024 px (tablet deitado e computador). No servidor, false. */
export function useTelaGrande(): boolean {
  return useSyncExternalStore(
    assinar,
    () => window.matchMedia(CONSULTA).matches,
    () => false,
  );
}
