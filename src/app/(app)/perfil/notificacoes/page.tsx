import { PreferenciasNotificacoes } from "@/features/notificacoes/preferencias";
import { exigirPerfil } from "@/lib/sessao";

export const metadata = { title: "Notificações | Madame Fê Clinic" };

export default async function PreferenciasNotificacoesPage() {
  const { colaborador } = await exigirPerfil();
  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-titulo text-2xl font-semibold tracking-wide text-ouro-escuro">Minhas preferências</h1>
      <PreferenciasNotificacoes perfil={colaborador.perfil} />
    </div>
  );
}
