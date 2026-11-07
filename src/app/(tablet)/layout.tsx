import { Toaster } from "@/components/ui/sonner";
import { exigirPerfil } from "@/lib/sessao";

export const dynamic = "force-dynamic";

export default async function TabletLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  await exigirPerfil();
  return (
    <div className="min-h-dvh bg-blush">
      {children}
      <Toaster />
    </div>
  );
}
