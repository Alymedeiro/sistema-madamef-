import type { Metadata } from "next";
import Link from "next/link";
import { CartaoAutenticacao } from "@/components/shell/cartao-autenticacao";
import { FormularioRecuperacao } from "./formulario-recuperacao";

export const metadata: Metadata = { title: "Esqueci minha senha | Madame Fê Clinic" };

export default function EsqueciSenhaPage() {
  return (
    <CartaoAutenticacao titulo="Esqueci minha senha">
      <p className="text-sm text-muted-foreground">
        Informe o e-mail do seu acesso e enviaremos um link para criar uma nova senha.
      </p>
      <FormularioRecuperacao />
      <Link
        href="/login"
        className="inline-flex min-h-11 items-center justify-center text-sm font-medium text-ouro-escuro underline-offset-4 hover:underline"
      >
        Voltar para o login
      </Link>
    </CartaoAutenticacao>
  );
}
