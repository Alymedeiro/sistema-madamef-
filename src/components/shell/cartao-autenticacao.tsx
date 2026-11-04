import { Logo } from "@/components/shell/logo";
import { Card, CardContent } from "@/components/ui/card";

/** Moldura das telas fora do app (login, definir senha, esqueci a senha). */
export function CartaoAutenticacao({
  titulo,
  children,
}: {
  titulo: string;
  children: React.ReactNode;
}) {
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
          <h2 className="font-titulo text-lg font-semibold text-ouro-escuro">{titulo}</h2>
          {children}
        </CardContent>
      </Card>
    </main>
  );
}
