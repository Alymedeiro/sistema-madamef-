import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { AbaFolgas, type BloqueioItem } from "@/features/equipe/aba-folgas";
import { AbaJornada } from "@/features/equipe/aba-jornada";
import { AbaServicos, type ServicoOpcao } from "@/features/equipe/aba-servicos";
import { BotaoAtivo } from "@/features/equipe/botao-ativo";
import { FormularioColaborador } from "@/features/equipe/formulario-colaborador";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { agruparJornadasPorDia } from "@/lib/dominio/intervalos";
import { formatarNoFuso } from "@/lib/dominio/tempo";
import { exigirPerfil } from "@/lib/sessao";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Colaborador | Madame Fê Clinic" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function Titulo({ children }: { children: React.ReactNode }) {
  return (
    <h1 className="font-titulo text-2xl font-semibold tracking-wide text-ouro-escuro">
      {children}
    </h1>
  );
}

function Voltar() {
  return (
    <Link
      href="/equipe"
      className="inline-flex min-h-11 items-center gap-2 self-start text-sm font-medium text-ouro-escuro underline-offset-4 hover:underline"
    >
      <ArrowLeft className="size-4" aria-hidden />
      Equipe
    </Link>
  );
}

export default async function ColaboradorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { colaborador: eu } = await exigirPerfil("dona");
  const { id } = await params;

  if (id === "novo") {
    return (
      <div className="flex flex-col gap-4">
        <Voltar />
        <Titulo>Novo colaborador</Titulo>
        <FormularioColaborador modo="novo" />
      </div>
    );
  }
  if (!UUID.test(id)) notFound();

  const supabase = await createClient();
  const agora = new Date().toISOString();

  // Página só da dona (exigirPerfil acima): o percentual só é lido por ela.
  const [colab, jornadas, bloqueios, servicos, vinculos, comissao] = await Promise.all([
    supabase
      .from("colaboradores")
      .select("id, usuario_auth_id, nome, funcao, perfil, telefone, cor, ativo")
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("jornadas")
      .select("dia_semana, hora_inicio, hora_fim")
      .eq("colaborador_id", id),
    supabase
      .from("bloqueios_agenda")
      .select("id, inicio, fim, motivo")
      .eq("colaborador_id", id)
      .gte("fim", agora)
      .order("inicio", { ascending: true }),
    supabase
      .from("servicos")
      .select("id, nome, categorias_servico(nome)")
      .eq("ativo", true)
      .order("nome", { ascending: true }),
    supabase.from("colaborador_servicos").select("servico_id").eq("colaborador_id", id),
    supabase
      .from("colaboradores_comissao")
      .select("percentual")
      .eq("colaborador_id", id)
      .maybeSingle(),
  ]);

  for (const r of [colab, jornadas, bloqueios, servicos, vinculos, comissao]) {
    if (r.error) throw new Error(`Falha ao carregar o colaborador: ${r.error.message}`);
  }
  const c = colab.data;
  if (!c) notFound();

  // O e-mail mora no Auth (a tabela colaboradores não o guarda).
  let email: string | null = null;
  if (c.usuario_auth_id) {
    try {
      const { data } = await createAdminClient().auth.admin.getUserById(c.usuario_auth_id);
      email = data.user?.email ?? null;
    } catch {
      email = null;
    }
  }

  const bloqueiosItens: BloqueioItem[] = (bloqueios.data ?? []).map((b) => ({
    id: b.id,
    inicioTexto: formatarNoFuso(b.inicio, "dd/MM/yyyy HH:mm"),
    fimTexto: formatarNoFuso(b.fim, "dd/MM/yyyy HH:mm"),
    motivo: b.motivo,
  }));

  const opcoesServico: ServicoOpcao[] = (servicos.data ?? []).map((s) => {
    const cat = Array.isArray(s.categorias_servico) ? s.categorias_servico[0] : s.categorias_servico;
    return { id: s.id, nome: s.nome, categoria: cat?.nome ?? "Sem categoria" };
  });

  const jornadaInicial = agruparJornadasPorDia(
    (jornadas.data ?? []).map((j) => ({
      diaSemana: j.dia_semana,
      horaInicio: j.hora_inicio,
      horaFim: j.hora_fim,
    })),
  );

  return (
    <div className="flex flex-col gap-4">
      <Voltar />
      <div className="flex flex-wrap items-center gap-3">
        <span
          aria-hidden
          className="size-5 shrink-0 rounded-full border"
          style={{ backgroundColor: c.cor }}
        />
        <Titulo>{c.nome}</Titulo>
        {!c.ativo ? <Badge variant="destructive">Inativa</Badge> : null}
        <div className="ml-auto">
          <BotaoAtivo id={c.id} nome={c.nome} ativo={c.ativo} ehVoceMesma={c.id === eu.id} />
        </div>
      </div>

      <Tabs defaultValue="dados">
        <TabsList>
          <TabsTrigger value="dados">Dados</TabsTrigger>
          <TabsTrigger value="jornada">Jornada</TabsTrigger>
          <TabsTrigger value="folgas">Folgas e férias</TabsTrigger>
          <TabsTrigger value="servicos">Serviços que realiza</TabsTrigger>
        </TabsList>
        <TabsContent value="dados">
          <FormularioColaborador
            modo="editar"
            id={c.id}
            email={email}
            ehVoceMesma={c.id === eu.id}
            valores={{
              nome: c.nome,
              funcao: c.funcao,
              perfil: c.perfil,
              cor: c.cor,
              telefone: c.telefone,
            }}
            comissaoPadraoPct={comissao.data ? Number(comissao.data.percentual) : null}
          />
        </TabsContent>
        <TabsContent value="jornada">
          <AbaJornada colaboradorId={c.id} inicial={jornadaInicial} />
        </TabsContent>
        <TabsContent value="folgas">
          <AbaFolgas colaboradorId={c.id} bloqueios={bloqueiosItens} />
        </TabsContent>
        <TabsContent value="servicos">
          <AbaServicos
            colaboradorId={c.id}
            servicos={opcoesServico}
            selecionados={(vinculos.data ?? []).map((v) => v.servico_id)}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
