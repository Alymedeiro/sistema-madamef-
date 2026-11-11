import Link from "next/link";
import type { TipoModelo } from "./schemas";
import { SecaoWhatsapp } from "@/features/whatsapp/secao-whatsapp";
import { FormularioConfiguracoes } from "@/features/configuracoes/formulario-configuracoes";
import { horarioDoBanco } from "@/lib/dominio/intervalos";
import { ROTULO_TIPO_MENSAGEM } from "@/lib/dominio/whatsapp";
import { formatarTelefone } from "@/lib/dominio/telefone";
import { exigirPerfil } from "@/lib/sessao";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Configurações | Madame Fê Clinic" };

export default async function ConfiguracoesPage() {
  await exigirPerfil("dona");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("configuracoes_clinica")
    .select(
      "nome, telefone, endereco, horario_funcionamento, online_ativo, online_antecedencia_min_horas, online_antecedencia_max_dias, online_aviso_privacidade, whatsapp_ativo, whatsapp_janela_inicio, whatsapp_janela_fim, whatsapp_limite_por_hora",
    )
    .maybeSingle();
  if (error) throw new Error(`Falha ao carregar as configurações: ${error.message}`);

  const [{ data: modelos, error: erroModelos }, { data: status }] = await Promise.all([
    supabase.from("modelos_mensagem").select("tipo, variacoes, ativo"),
    supabase.from("whatsapp_status").select("estado").maybeSingle(),
  ]);
  if (erroModelos) throw new Error(`Falha ao carregar os modelos: ${erroModelos.message}`);
  const ordem = Object.keys(ROTULO_TIPO_MENSAGEM);
  const modelosOrdenados = (modelos ?? [])
    .filter((m): m is typeof m & { tipo: TipoModelo } => m.tipo !== "avulsa")
    .sort((a, b) => ordem.indexOf(a.tipo) - ordem.indexOf(b.tipo));

  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-titulo text-2xl font-semibold tracking-wide text-ouro-escuro">
        Configurações
      </h1>
      <nav aria-label="Modelos da ficha clínica" className="flex flex-wrap gap-2">
        <Link
          href="/configuracoes/anamnese"
          className="inline-flex min-h-11 items-center rounded-md border bg-card px-4 text-sm font-medium text-ouro-escuro hover:bg-accent"
        >
          Modelo de anamnese
        </Link>
        <Link
          href="/configuracoes/termos"
          className="inline-flex min-h-11 items-center rounded-md border bg-card px-4 text-sm font-medium text-ouro-escuro hover:bg-accent"
        >
          Termos
        </Link>
        <Link
          href="/configuracoes/acessos"
          className="inline-flex min-h-11 items-center rounded-md border bg-card px-4 text-sm font-medium text-ouro-escuro hover:bg-accent"
        >
          Registro de acessos
        </Link>
      </nav>
      <FormularioConfiguracoes
        inicial={{
          nome: data?.nome ?? "Madame Fê Clinic",
          telefone: data?.telefone ? formatarTelefone(data.telefone) : "",
          endereco: data?.endereco ?? "",
          horario: horarioDoBanco(data?.horario_funcionamento),
          onlineAtivo: data?.online_ativo ?? false,
          onlineAntecedenciaMinHoras: data?.online_antecedencia_min_horas ?? 2,
          onlineAntecedenciaMaxDias: data?.online_antecedencia_max_dias ?? 60,
          onlineAvisoPrivacidade: data?.online_aviso_privacidade ?? "",
        }}
        siteUrl={process.env.NEXT_PUBLIC_SITE_URL ?? ""}
      />
      <SecaoWhatsapp
        inicial={{
          ativo: data?.whatsapp_ativo ?? false,
          janelaInicio: (data?.whatsapp_janela_inicio ?? "09:00").slice(0, 5),
          janelaFim: (data?.whatsapp_janela_fim ?? "19:00").slice(0, 5),
          limitePorHora: data?.whatsapp_limite_por_hora ?? 20,
        }}
        estado={status?.estado ?? "sem_chaves"}
        clinica={data?.nome ?? "Madame Fê Clinic"}
        modelos={modelosOrdenados}
      />
    </div>
  );
}
