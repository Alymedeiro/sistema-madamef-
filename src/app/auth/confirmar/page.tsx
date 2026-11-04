import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CartaoAutenticacao } from "@/components/shell/cartao-autenticacao";
import { Button } from "@/components/ui/button";
import { lerConfirmacao } from "@/lib/auth/confirmar";
import { confirmarLink } from "./actions";

export const metadata: Metadata = { title: "Confirmar acesso | Madame Fê Clinic" };
export const dynamic = "force-dynamic";

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/**
 * Destino dos links de e-mail (convite e recuperação de senha). O GET só mostra
 * o botão "Continuar": antivírus de e-mail que abrem o link sozinhos não gastam
 * o token. A verificação acontece no POST (Server Action confirmarLink).
 */
export default async function ConfirmarPage({ searchParams }: Props) {
  const params = await searchParams;
  const confirmacao = lerConfirmacao({
    get: (campo: string) => {
      const valor = params[campo];
      return typeof valor === "string" ? valor : null;
    },
  });
  if (!confirmacao) redirect("/login?motivo=link-invalido");

  const convite = confirmacao.tipo === "invite";
  return (
    <CartaoAutenticacao titulo={convite ? "Ative o seu acesso" : "Recupere a sua senha"}>
      <p className="text-sm text-muted-foreground">
        {convite
          ? "Toque em Continuar para ativar o seu acesso e criar a sua senha."
          : "Toque em Continuar para escolher uma nova senha."}
      </p>
      <form action={confirmarLink} className="flex flex-col">
        <input type="hidden" name="token_hash" value={confirmacao.tokenHash} />
        <input type="hidden" name="type" value={confirmacao.tipo} />
        <Button type="submit">Continuar</Button>
      </form>
    </CartaoAutenticacao>
  );
}
