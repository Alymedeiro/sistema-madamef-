// Rotas que o middleware deixa abrir sem login.

const PUBLICAS = ["/login", "/esqueci-senha"] as const;

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
