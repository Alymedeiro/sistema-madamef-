import type { Metadata } from "next";
import { CartaoAutenticacao } from "@/components/shell/cartao-autenticacao";
import { exigirPerfil } from "@/lib/sessao";
import { FormularioSenha } from "./formulario-senha";

export const metadata: Metadata = { title: "Definir senha | Madame Fê Clinic" };
export const dynamic = "force-dynamic";

export default async function DefinirSenhaPage({
  searchParams,
}: {
  searchParams: Promise<{ trocar?: string }>;
}) {
  // Exige sessão de colaborador ativo, de qualquer perfil.
  await exigirPerfil();
  // ?trocar=1: veio de "Trocar senha" (já tem senha), com opção de voltar.
  const trocar = (await searchParams).trocar === "1";
  return (
    <CartaoAutenticacao titulo={trocar ? "Trocar senha" : "Crie a sua senha"}>
      <FormularioSenha trocar={trocar} />
    </CartaoAutenticacao>
  );
}
