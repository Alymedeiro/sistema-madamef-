import { exigirPerfil } from "@/lib/sessao";

// Placeholder da Task 6; a Task 13 substitui pelo painel do dia.
export default async function InicioPage() {
  await exigirPerfil();
  return (
    <h1 className="font-titulo text-2xl font-semibold tracking-wide text-ouro-escuro">
      Início
    </h1>
  );
}
