// Rotas que o middleware deixa abrir sem login.

// "/e2e-harness" só existe nos builds feitos pelo Playwright (NEXT_PUBLIC_E2E_HARNESS=1).
const PUBLICAS: readonly string[] = [
  "/login",
  "/esqueci-senha",
  ...(process.env.NEXT_PUBLIC_E2E_HARNESS === "1" ? ["/e2e-harness"] : []),
];

export function ehRotaPublica(pathname: string): boolean {
  return (
    PUBLICAS.some((r) => pathname === r || pathname.startsWith(`${r}/`)) ||
    ehRotaDeConfirmacao(pathname)
  );
}

/** Link de e-mail (convite/recuperação): chega sem sessão e cria a sessão aqui. */
export function ehRotaDeConfirmacao(pathname: string): boolean {
  return pathname === "/auth/confirmar" || pathname === "/auth/confirmar/";
}
