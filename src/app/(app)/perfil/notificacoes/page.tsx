import Link from "next/link";
import { KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PreferenciasNotificacoes } from "@/features/notificacoes/preferencias";
import { exigirPerfil } from "@/lib/sessao";

export const metadata = { title: "Notificações | Madame Fê Clinic" };

export default async function PreferenciasNotificacoesPage() {
  const { colaborador } = await exigirPerfil();
  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-titulo text-2xl font-semibold tracking-wide text-ouro-escuro">Minhas preferências</h1>
      <PreferenciasNotificacoes perfil={colaborador.perfil} />
      <section className="flex max-w-3xl flex-col gap-3" aria-labelledby="titulo-senha">
        <h2 id="titulo-senha" className="font-titulo text-lg font-semibold text-ouro-escuro">
          Senha
        </h2>
        <p className="text-sm text-muted-foreground">
          Troque a senha que você usa para entrar no sistema.
        </p>
        <Button asChild variant="outline" className="self-start">
          <Link href="/definir-senha?trocar=1">
            <KeyRound aria-hidden />
            Trocar senha
          </Link>
        </Button>
      </section>
    </div>
  );
}
