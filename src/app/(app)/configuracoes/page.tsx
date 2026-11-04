import { FormularioConfiguracoes } from "@/features/configuracoes/formulario-configuracoes";
import { horarioDoBanco } from "@/lib/dominio/intervalos";
import { formatarTelefone } from "@/lib/dominio/telefone";
import { exigirPerfil } from "@/lib/sessao";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Configurações | Madame Fê Clinic" };

export default async function ConfiguracoesPage() {
  await exigirPerfil("dona");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("configuracoes_clinica")
    .select("nome, telefone, endereco, horario_funcionamento")
    .maybeSingle();
  if (error) throw new Error(`Falha ao carregar as configurações: ${error.message}`);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-titulo text-2xl font-semibold tracking-wide text-ouro-escuro">
        Configurações
      </h1>
      <FormularioConfiguracoes
        inicial={{
          nome: data?.nome ?? "Madame Fê Clinic",
          telefone: data?.telefone ? formatarTelefone(data.telefone) : "",
          endereco: data?.endereco ?? "",
          horario: horarioDoBanco(data?.horario_funcionamento),
        }}
      />
    </div>
  );
}
