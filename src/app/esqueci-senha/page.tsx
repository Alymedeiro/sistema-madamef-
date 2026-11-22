import type { Metadata } from "next";
import Link from "next/link";
import { CartaoAutenticacao } from "@/components/shell/cartao-autenticacao";

export const metadata: Metadata = { title: "Esqueci minha senha | Madame Fê Clinic" };

export default function EsqueciSenhaPage() {
  return (
    <CartaoAutenticacao titulo="Esqueci minha senha">
      <div className="flex flex-col gap-3 text-base">
        <p>
          Fale com a <strong>dona da clínica</strong>. Ela cria uma <strong>senha provisória</strong>{" "}
          para você em <em>Equipe → seu nome → Redefinir senha</em>.
        </p>
        <p>
          Entre com essa senha provisória: o sistema vai pedir que você crie a sua própria senha
          logo em seguida.
        </p>
        <p className="text-sm text-muted-foreground">
          Lembra a senha atual e só quer mudar? Use &quot;Trocar senha&quot; na tela de login.
        </p>
      </div>
      <Link
        href="/login"
        className="inline-flex min-h-11 items-center justify-center text-sm font-medium text-ouro-escuro underline-offset-4 hover:underline"
      >
        Voltar para o login
      </Link>
    </CartaoAutenticacao>
  );
}
