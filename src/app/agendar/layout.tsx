import type { Metadata } from "next";
import { Logo } from "@/components/shell/logo";

export const metadata: Metadata = {
  title: "Agendar horário | Madame Fê Clinic",
  description: "Peça seu horário na Madame Fê Clinic.",
};

// Fora do grupo (app): sem menu e sem login.
export default function AgendarLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col items-center gap-6 bg-blush px-4 py-8">
      <header className="flex flex-col items-center gap-3 text-center">
        <Logo tamanho="md" alt="" />
        <h1 className="font-titulo text-2xl font-semibold tracking-wide text-ouro-escuro sm:text-3xl">
          Madame Fê Clinic
        </h1>
      </header>
      <div className="w-full max-w-xl">{children}</div>
    </main>
  );
}
