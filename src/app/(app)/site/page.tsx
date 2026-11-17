import { SITE_CLINICA, VisualizarSite } from "@/features/site/visualizar-site";
import { exigirPerfil } from "@/lib/sessao";

export const metadata = { title: "Site | Madame Fê Clinic" };

export default async function SitePage() {
  await exigirPerfil("dona");
  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-titulo text-2xl font-semibold tracking-wide text-ouro-escuro">
        Site da clínica
      </h1>
      <VisualizarSite url={SITE_CLINICA} />
    </div>
  );
}
