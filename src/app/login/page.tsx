import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Logo } from "@/components/shell/logo";
import { Card, CardContent } from "@/components/ui/card";
import { getSessao } from "@/lib/sessao";
import { FormularioLogin } from "./formulario-login";

export const metadata: Metadata = { title: "Entrar | Madame Fê Clinic" };

async function jaLogada(): Promise<boolean> {
  try {
    return (await getSessao()) !== null;
  } catch {
    // Backend indisponível: a tela de login precisa abrir mesmo assim.
    return false;
  }
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ motivo?: string }>;
}) {
  const { motivo } = await searchParams;
  const inativo = motivo === "inativo";

  // Quem já tem acesso ativo não precisa ver o login de novo.
  if (!inativo && (await jaLogada())) redirect("/inicio");

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-blush px-4 py-10">
      <div className="flex flex-col items-center gap-4 text-center">
        <Logo tamanho="lg" alt="" />
        <h1 className="font-titulo text-3xl font-semibold tracking-wide text-ouro-escuro sm:text-4xl">
          Madame Fê Clinic
        </h1>
      </div>
      <Card className="w-full max-w-sm">
        <CardContent className="flex flex-col gap-4">
          {inativo ? (
            <p
              role="alert"
              className="rounded-md border border-destructive bg-card px-3 py-2 text-sm font-medium text-destructive"
            >
              Seu acesso foi desativado. Fale com a responsável pela clínica.
            </p>
          ) : null}
          <FormularioLogin />
        </CardContent>
      </Card>
    </main>
  );
}
