import { Card, CardContent } from "@/components/ui/card";
import { FormularioAgendar } from "@/features/online/formulario-agendar";
import type { ProfissionalOnline, ServicoOnline } from "@/features/online/tipos";
import { diasDisponiveis } from "@/lib/dominio/online";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

function Aviso({ children }: { children: React.ReactNode }) {
  return (
    <Card>
      <CardContent>
        <p role="status" className="text-center text-base font-medium">
          {children}
        </p>
      </CardContent>
    </Card>
  );
}

export default async function AgendarPage() {
  const admin = createAdminClient();
  const { data: config } = await admin
    .from("configuracoes_clinica")
    .select(
      "nome, telefone, online_ativo, online_aviso_privacidade, online_antecedencia_min_horas, online_antecedencia_max_dias",
    )
    .limit(1)
    .maybeSingle();

  if (!config?.online_ativo) {
    const tel = config?.telefone ? `: ${config.telefone}` : ".";
    return <Aviso>{`Agendamento online indisponível no momento. Fale com a clínica${tel}`}</Aviso>;
  }

  const [{ data: servicosDb }, { data: colaboradoresDb }, { data: vinculos }] = await Promise.all([
    admin
      .from("servicos")
      .select("id, nome, duracao_min, exige_avaliacao")
      .eq("ativo", true)
      .eq("permite_online", true)
      .order("nome"),
    admin.from("colaboradores").select("id, nome").eq("ativo", true).order("nome"),
    admin.from("colaborador_servicos").select("colaborador_id, servico_id"),
  ]);

  const servicos: ServicoOnline[] = (servicosDb ?? []).map((s) => ({
    id: s.id,
    nome: s.nome,
    duracaoMin: s.duracao_min,
    exigeAvaliacao: s.exige_avaliacao,
  }));
  const online = new Set(servicos.map((s) => s.id));
  const profissionais: ProfissionalOnline[] = (colaboradoresDb ?? [])
    .map((c) => ({
      id: c.id,
      nome: c.nome.trim().split(/\s+/)[0] ?? "",
      servicoIds: (vinculos ?? [])
        .filter((v) => v.colaborador_id === c.id && online.has(v.servico_id))
        .map((v) => v.servico_id),
    }))
    .filter((p) => p.servicoIds.length > 0);

  const comProfissional = servicos.filter((s) =>
    profissionais.some((p) => p.servicoIds.includes(s.id)),
  );
  if (comProfissional.length === 0) {
    return <Aviso>Nenhum serviço disponível para agendamento online no momento.</Aviso>;
  }

  return (
    <FormularioAgendar
      servicos={comProfissional}
      profissionais={profissionais}
      dias={diasDisponiveis(new Date(), config.online_antecedencia_max_dias)}
      avisoPrivacidade={config.online_aviso_privacidade}
      siteKey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? ""}
    />
  );
}
