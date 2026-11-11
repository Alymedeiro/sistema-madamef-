// Rotas que o middleware deixa abrir sem login.

// "/e2e-harness" só existe nos builds feitos pelo Playwright (NEXT_PUBLIC_E2E_HARNESS=1).
const PUBLICAS: readonly string[] = [
  "/login",
  "/esqueci-senha",
  // Página pública de pedido de horário (Fase 3A).
  "/agendar",
  ...(process.env.NEXT_PUBLIC_E2E_HARNESS === "1" ? ["/e2e-harness"] : []),
];

// Rotas de API chamadas por máquinas (Fase 3B): autenticam pelo próprio token
// (relógio: x-cron-token; webhook da Z-API: ?token=), não por sessão.
const API_PUBLICAS: readonly string[] = ["/api/whatsapp/processar", "/api/webhooks/zapi"];

export function ehRotaPublica(pathname: string): boolean {
  return (
    PUBLICAS.some((r) => pathname === r || pathname.startsWith(`${r}/`)) ||
    API_PUBLICAS.some((r) => pathname === r || pathname === `${r}/`) ||
    ehRotaDeConfirmacao(pathname)
  );
}

/** Link de e-mail (convite/recuperação): chega sem sessão e cria a sessão aqui. */
export function ehRotaDeConfirmacao(pathname: string): boolean {
  return pathname === "/auth/confirmar" || pathname === "/auth/confirmar/";
}
