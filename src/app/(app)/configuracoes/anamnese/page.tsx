import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { EditorModeloAnamnese } from "@/features/ficha/anamnese/editor-modelo-anamnese";
import type { Pergunta } from "@/lib/dominio/anamnese";
import { exigirPerfil } from "@/lib/sessao";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Modelo de anamnese | Madame Fê Clinic" };

export default async function ModeloAnamnesePage() {
  await exigirPerfil("dona");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("modelos_anamnese")
    .select("titulo, versao, perguntas")
    .eq("ativo", true)
    .maybeSingle();
  if (error) throw new Error(`Falha ao carregar o modelo: ${error.message}`);

  return (
    <div className="flex flex-col gap-6">
      <Link
        href="/configuracoes"
        className="inline-flex min-h-11 items-center gap-2 self-start text-sm font-medium text-ouro-escuro underline-offset-4 hover:underline"
      >
        <ArrowLeft className="size-4" aria-hidden />
        Configurações
      </Link>
      <h1 className="font-titulo text-2xl font-semibold tracking-wide text-ouro-escuro">
        Modelo de anamnese
      </h1>
      {data ? (
        <EditorModeloAnamnese
          titulo={data.titulo}
          versao={data.versao}
          perguntas={data.perguntas as unknown as Pergunta[]}
        />
      ) : (
        <p className="text-muted-foreground">Nenhum modelo ativo encontrado.</p>
      )}
    </div>
  );
}
