import type { Metadata } from "next";
import { CartaoAutenticacao } from "@/components/shell/cartao-autenticacao";
import { exigirSessaoParaSenha } from "@/lib/sessao";
import { FormularioSenha } from "./formulario-senha";

export const metadata: Metadata = { title: "Definir senha | Madame Fê Clinic" };
export const dynamic = "force-dynamic";

export default async function DefinirSenhaPage({
  searchParams,
}: {
  searchParams: Promise<{ trocar?: string }>;
}) {
  // Exige sessão de colaborador ativo, de qualquer perfil.
  const sessao = await exigirSessaoParaSenha();
  // ?trocar=1: veio de "Trocar senha" (já tem senha), com opção de voltar.
  // Senha provisória: troca obrigatória, sem "Cancelar".
  const trocar = (await searchParams).trocar === "1" && !sessao.trocaObrigatoria;
  return (
    <CartaoAutenticacao
      titulo={sessao.trocaObrigatoria ? "Crie uma nova senha" : trocar ? "Trocar senha" : "Crie a sua senha"}
    >
      {sessao.trocaObrigatoria ? (
        <p className="text-sm text-muted-foreground">
          Você entrou com uma senha provisória. Para continuar, crie a sua própria senha.
        </p>
      ) : null}
      <FormularioSenha trocar={trocar} />
    </CartaoAutenticacao>
  );
}
