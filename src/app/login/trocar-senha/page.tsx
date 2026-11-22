import type { Metadata } from "next";
import Link from "next/link";
import { CartaoAutenticacao } from "@/components/shell/cartao-autenticacao";
import { FormularioTroca } from "./formulario-troca";

export const metadata: Metadata = { title: "Trocar senha | Madame Fê Clinic" };

export default function TrocarSenhaPage() {
  return (
    <CartaoAutenticacao titulo="Trocar senha">
      <p className="text-sm text-muted-foreground">
        Informe o seu e-mail, a senha que você usa hoje e a nova senha.
      </p>
      <FormularioTroca />
      <Link
        href="/login"
        className="inline-flex min-h-11 items-center justify-center text-sm font-medium text-ouro-escuro underline-offset-4 hover:underline"
      >
        Voltar para o login
      </Link>
    </CartaoAutenticacao>
  );
}
