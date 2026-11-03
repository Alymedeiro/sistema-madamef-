import { Logo } from "@/components/shell/logo";

// Página temporária da Task 1; vira redirect para /inicio na Task 6.
export default function Home() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-blush px-4 py-10 text-center">
      <Logo tamanho="lg" />
      <h1 className="font-titulo text-3xl font-semibold tracking-wide text-ouro-escuro sm:text-5xl">
        Madame Fê Clinic
      </h1>
      <p className="text-base text-texto">Agenda, clientes e caixa</p>
    </main>
  );
}
