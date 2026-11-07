import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { EditorModeloTermo } from "@/features/ficha/termos/editor-modelo-termo";
import { exigirPerfil } from "@/lib/sessao";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Termos de consentimento | Madame Fê Clinic" };

export default async function TermosConfiguracaoPage() {
  await exigirPerfil("dona");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("modelos_termo")
    .select("id, titulo, texto, versao")
    .eq("ativo", true)
    .order("titulo", { ascending: true });
  if (error) throw new Error(`Falha ao carregar os termos: ${error.message}`);
  const termos = data ?? [];

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <Link
        href="/configuracoes"
        className="inline-flex min-h-11 items-center gap-2 self-start text-sm font-medium text-ouro-escuro underline-offset-4 hover:underline"
      >
        <ArrowLeft className="size-4" aria-hidden />
        Configurações
      </Link>
      <h1 className="font-titulo text-2xl font-semibold tracking-wide text-ouro-escuro">
        Termos de consentimento
      </h1>

      <section aria-labelledby="termos-ativos" className="flex flex-col gap-3">
        <h2 id="termos-ativos" className="font-titulo text-lg font-semibold text-ouro-escuro">
          Termos ativos
        </h2>
        {termos.length === 0 ? (
          <p className="text-muted-foreground">Nenhum termo cadastrado ainda.</p>
        ) : (
          termos.map((t) => (
            <details key={t.id} className="rounded-xl border bg-card p-4">
              <summary className="min-h-11 cursor-pointer py-2 text-base font-medium">
                {t.titulo} <span className="text-sm text-muted-foreground">· versão {t.versao}</span>
              </summary>
              <div className="mt-3">
                <EditorModeloTermo
                  key={t.id}
                  anteriorId={t.id}
                  titulo={t.titulo}
                  texto={t.texto}
                  versao={t.versao}
                />
              </div>
            </details>
          ))
        )}
      </section>

      <section aria-labelledby="termo-novo" className="flex flex-col gap-3 rounded-xl border bg-card p-4">
        <h2 id="termo-novo" className="font-titulo text-lg font-semibold text-ouro-escuro">
          Novo termo
        </h2>
        <EditorModeloTermo />
      </section>
    </div>
  );
}
