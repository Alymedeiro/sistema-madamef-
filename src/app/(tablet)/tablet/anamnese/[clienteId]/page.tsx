import { notFound } from "next/navigation";
import { FormularioAnamnese } from "@/features/ficha/anamnese/formulario-anamnese";
import { MolduraTablet } from "@/features/ficha/moldura-tablet";
import type { Pergunta } from "@/lib/dominio/anamnese";
import { exigirPerfil } from "@/lib/sessao";
import { createClient } from "@/lib/supabase/server";
import { idSchema } from "@/lib/validacao";

export const metadata = { title: "Anamnese | Madame Fê Clinic" };

export default async function TabletAnamnesePage({
  params,
}: {
  params: Promise<{ clienteId: string }>;
}) {
  // Aplicam a anamnese: dona e recepção (a profissional só consulta).
  await exigirPerfil("dona", "recepcao");
  const { clienteId } = await params;
  if (!idSchema.safeParse(clienteId).success) notFound();

  const supabase = await createClient();
  const [clienteRes, modeloRes] = await Promise.all([
    supabase.from("clientes").select("id, nome").eq("id", clienteId).maybeSingle(),
    supabase
      .from("modelos_anamnese")
      .select("id, titulo, perguntas")
      .eq("ativo", true)
      .maybeSingle(),
  ]);
  if (clienteRes.error) throw new Error(`Falha ao carregar a cliente: ${clienteRes.error.message}`);
  if (modeloRes.error) throw new Error(`Falha ao carregar o modelo: ${modeloRes.error.message}`);
  if (!clienteRes.data || !modeloRes.data) notFound();

  return (
    <MolduraTablet
      titulo={modeloRes.data.titulo}
      voltarPara={`/clientes/${clienteId}?aba=anamnese`}
    >
      <FormularioAnamnese
        clienteId={clienteId}
        clienteNome={clienteRes.data.nome}
        modelo={{
          id: modeloRes.data.id,
          titulo: modeloRes.data.titulo,
          perguntas: modeloRes.data.perguntas as unknown as Pergunta[],
        }}
      />
    </MolduraTablet>
  );
}
