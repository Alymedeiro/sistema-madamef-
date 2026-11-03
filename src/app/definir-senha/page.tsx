import type { Metadata } from "next";
import { CartaoAutenticacao } from "@/components/shell/cartao-autenticacao";
import { exigirPerfil } from "@/lib/sessao";
import { FormularioSenha } from "./formulario-senha";

export const metadata: Metadata = { title: "Definir senha | Madame Fê Clinic" };
export const dynamic = "force-dynamic";

export default async function DefinirSenhaPage() {
  // Exige sessão de colaborador ativo, de qualquer perfil.
  await exigirPerfil();
  return (
    <CartaoAutenticacao titulo="Crie a sua senha">
      <FormularioSenha />
    </CartaoAutenticacao>
  );
}
