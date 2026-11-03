import { LogOut } from "lucide-react";
import { Logo } from "@/components/shell/logo";
import { MenuInferior, MenuLateral } from "@/components/shell/menu";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/sonner";
import {
  ITENS_MENU,
  podeAcessar,
  ROTULO_PERFIL,
} from "@/lib/dominio/permissoes";
import { sair } from "@/app/login/actions";
import { exigirPerfil } from "@/lib/sessao";

// Sempre dinâmico: depende da sessão de cada requisição.
export const dynamic = "force-dynamic";

export default async function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const { colaborador } = await exigirPerfil();
  const itens = ITENS_MENU.filter((i) => podeAcessar(colaborador.perfil, i.recurso));

  return (
    <div className="min-h-dvh lg:pl-64">
      <aside className="fixed inset-y-0 left-0 hidden w-64 flex-col gap-6 border-r bg-card p-4 lg:flex">
        <div className="flex flex-col items-center gap-2 pt-2 text-center">
          <Logo tamanho="md" alt="" className="rounded-md" />
          <span className="font-titulo text-lg font-semibold tracking-wide text-ouro-escuro">
            Madame Fê Clinic
          </span>
        </div>
        <MenuLateral itens={itens} />
      </aside>

      <header className="sticky top-0 z-20 flex min-h-16 items-center gap-3 border-b bg-card px-4">
        <div className="lg:hidden">
          <Logo tamanho="sm" className="rounded-md" />
        </div>
        <div className="ml-auto flex min-w-0 items-center gap-3">
          <div className="flex min-w-0 flex-col items-end gap-0.5 sm:flex-row sm:items-center sm:gap-2">
            <span className="max-w-[10rem] truncate text-sm font-medium sm:max-w-xs">
              {colaborador.nome}
            </span>
            <Badge variant="secondary">{ROTULO_PERFIL[colaborador.perfil]}</Badge>
          </div>
          <form action={sair}>
            <Button type="submit" variant="outline" size="sm">
              <LogOut aria-hidden />
              Sair
            </Button>
          </form>
        </div>
      </header>

      <main className="px-4 py-6 pb-24 lg:px-8 lg:pb-8">{children}</main>
      <MenuInferior itens={itens} />
      <Toaster />
    </div>
  );
}
