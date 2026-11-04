import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import {
  AbaHistorico,
  type AtendimentoHistorico,
} from "@/features/clientes/aba-historico";
import { BotaoAtivoCliente } from "@/features/clientes/botao-ativo-cliente";
import { FormularioCliente } from "@/features/clientes/formulario-cliente";
import { Badge } from "@/components/ui/badge";
import { AbasFicha } from "@/features/ficha/abas-ficha";
import { AbaAnamnese } from "@/features/ficha/anamnese/aba-anamnese";
import { AbaEvolucoes } from "@/features/ficha/evolucoes/aba-evolucoes";
import { AbaPacotes } from "@/features/ficha/pacotes/aba-pacotes";
import { AbaFotos } from "@/features/ficha/fotos/aba-fotos";
import { AbaTermos } from "@/features/ficha/termos/aba-termos";
import { formatarCPF } from "@/lib/dominio/cpf";
import {
  abasDaFicha,
  perfisComAcesso,
  podeNaFicha,
  type AbaFicha,
} from "@/lib/dominio/permissoes";
import { formatarTelefone } from "@/lib/dominio/telefone";
import { formatarNoFuso } from "@/lib/dominio/tempo";
import { exigirPerfil } from "@/lib/sessao";
import { createClient } from "@/lib/supabase/server";
import { idSchema } from "@/lib/validacao";
import {
  carregarAlertasCabecalho,
  carregarAnamneses,
  carregarEvolucoes,
  carregarFotos,
  carregarPacotes,
  carregarServicosVenda,
  carregarTermos,
} from "../ficha/dados";
import { ROTULO_ORIGEM, type OrigemCliente } from "../schemas";

export const metadata = { title: "Cliente | Madame Fê Clinic" };

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
      href="/clientes"
      className="inline-flex min-h-11 items-center gap-2 self-start text-sm font-medium text-ouro-escuro underline-offset-4 hover:underline"
    >
      <ArrowLeft className="size-4" aria-hidden />
      Clientes
    </Link>
  );
}

const um = <T,>(v: T | T[] | null | undefined): T | null =>
  Array.isArray(v) ? (v[0] ?? null) : (v ?? null);

function Linha({
  rotulo,
  valor,
}: {
  rotulo: string;
  valor: string | null | undefined;
}) {
  return (
    <div>
      <dt className="text-sm text-muted-foreground">{rotulo}</dt>
      <dd className="break-words whitespace-pre-line">{valor || "—"}</dd>
    </div>
  );
}

export default async function ClientePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ aba?: string | string[] }>;
}) {
  const { colaborador } = await exigirPerfil(...perfisComAcesso("clientes"));
  const podeEditar = colaborador.perfil !== "profissional";
  const { id } = await params;
  const { aba: abaPedida } = await searchParams;
  const abas = abasDaFicha(colaborador.perfil);
  // Aba desconhecida ou sem permissão volta para "dados".
  const aba: AbaFicha = abas.find((a) => a === abaPedida) ?? "dados";

  if (id === "novo") {
    // Cadastro só para dona e recepção; profissional volta para /inicio.
    await exigirPerfil("dona", "recepcao");
    return (
      <div className="flex flex-col gap-4">
        <Voltar />
        <Titulo>Nova cliente</Titulo>
        <FormularioCliente />
      </div>
    );
  }
  if (!idSchema.safeParse(id).success) notFound();

  const supabase = await createClient();
  const [clienteRes, agendamentosRes] = await Promise.all([
    supabase
      .from("clientes")
      .select(
        "id, nome, cpf, whatsapp, email, data_nascimento, endereco, origem, observacoes, aceite_lgpd_em, aceita_whatsapp_marketing, ativo",
      )
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("agendamentos")
      .select(
        "id, inicio, status, valor_previsto_centavos, servico_id, profissional_id, servicos(nome), colaboradores!agendamentos_profissional_id_fkey(nome)",
      )
      .eq("cliente_id", id)
      .order("inicio", { ascending: false }),
  ]);
  if (clienteRes.error)
    throw new Error(`Falha ao carregar a cliente: ${clienteRes.error.message}`);
  if (agendamentosRes.error) {
    throw new Error(
      `Falha ao carregar o histórico: ${agendamentosRes.error.message}`,
    );
  }
  // O RLS devolve vazio para a profissional sem vínculo com a cliente: 404.
  const c = clienteRes.data;
  if (!c) notFound();

  const atendimentos: AtendimentoHistorico[] = (agendamentosRes.data ?? []).map(
    (a) => ({
      id: a.id,
      inicio: a.inicio,
      status: a.status,
      servico: um(a.servicos)?.nome ?? "Serviço",
      profissional: um(a.colaboradores)?.nome ?? "Profissional",
      valorPrevistoCentavos: a.valor_previsto_centavos,
    }),
  );

  const [cabecalho, anamneses, termos, fotos, evolucoes, pacotes, servicosVenda] = await Promise.all([
    carregarAlertasCabecalho(supabase, c.id),
    aba === "anamnese" ? carregarAnamneses(supabase, c.id) : Promise.resolve([]),
    aba === "termos" ? carregarTermos(supabase, c.id) : Promise.resolve(null),
    // `abas` já exclui "fotos" para a recepção; o RLS barra de novo no banco.
    aba === "fotos" ? carregarFotos(supabase, c.id) : Promise.resolve([]),
    aba === "evolucoes"
      ? carregarEvolucoes(supabase, c.id, colaborador.id)
      : Promise.resolve([]),
    aba === "pacotes" ? carregarPacotes(supabase, c.id) : Promise.resolve([]),
    aba === "pacotes" && podeNaFicha(colaborador.perfil, "vender_pacote")
      ? carregarServicosVenda(supabase)
      : Promise.resolve([]),
  ]);

  const origem = c.origem
    ? (ROTULO_ORIGEM[c.origem as OrigemCliente] ?? c.origem)
    : null;
  const aceiteEm = formatarNoFuso(c.aceite_lgpd_em, "dd/MM/yyyy 'às' HH:mm");

  return (
    <div className="flex flex-col gap-4">
      <Voltar />
      <div className="flex flex-wrap items-center gap-3">
        <Titulo>{c.nome}</Titulo>
        {!c.ativo ? <Badge variant="destructive">Inativa</Badge> : null}
        {podeEditar ? (
          <div className="ml-auto">
            <BotaoAtivoCliente id={c.id} nome={c.nome} ativo={c.ativo} />
          </div>
        ) : null}
      </div>

      {cabecalho.alertas.length > 0 || cabecalho.pendente ? (
        <div className="flex flex-col gap-2">
          {cabecalho.alertas.length > 0 ? (
            <p
              role="alert"
              className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm font-medium"
            >
              ⚠ Atenção: {cabecalho.alertas.join("; ")}
            </p>
          ) : null}
          {cabecalho.pendente ? (
            <p className="rounded-lg border bg-muted p-3 text-sm font-medium">
              Anamnese pendente
            </p>
          ) : null}
        </div>
      ) : null}

      <AbasFicha clienteId={c.id} abas={abas} atual={aba} />
      {aba === "pacotes" ? (
        <AbaPacotes
          clienteId={c.id}
          clienteNome={c.nome}
          pacotes={pacotes}
          servicos={servicosVenda}
          podeVender={podeNaFicha(colaborador.perfil, "vender_pacote")}
          podeCancelar={podeNaFicha(colaborador.perfil, "cancelar_pacote")}
        />
      ) : null}
      {aba === "anamnese" ? (
        <AbaAnamnese
          clienteId={c.id}
          anamneses={anamneses}
          podePreencher={podeNaFicha(colaborador.perfil, "aplicar_anamnese")}
        />
      ) : null}
      {aba === "termos" && termos ? (
        <AbaTermos
          clienteId={c.id}
          termos={termos}
          podeColher={podeNaFicha(colaborador.perfil, "colher_termo")}
        />
      ) : null}
      {aba === "fotos" ? (
        <AbaFotos
          clienteId={c.id}
          fotos={fotos}
          atendimentos={(agendamentosRes.data ?? []).map((a) => ({
            id: a.id,
            servicoId: a.servico_id,
            rotulo: `${formatarNoFuso(a.inicio, "dd/MM/yyyy HH:mm")} · ${um(a.servicos)?.nome ?? "Serviço"}`,
          }))}
          podeAdicionar={podeNaFicha(colaborador.perfil, "adicionar_foto")}
          podeArquivar={podeNaFicha(colaborador.perfil, "arquivar_foto")}
        />
      ) : null}
      {aba === "evolucoes" ? (
        <AbaEvolucoes
          evolucoes={evolucoes}
          // O mais recente primeiro (padrão do seletor); só os dela, a RLS barra o resto.
          atendimentos={(agendamentosRes.data ?? [])
            .filter((a) => a.profissional_id === colaborador.id)
            .map((a) => ({
              id: a.id,
              rotulo: `${formatarNoFuso(a.inicio, "dd/MM/yyyy HH:mm")} · ${um(a.servicos)?.nome ?? "Serviço"}`,
            }))}
          podeAdicionar={podeNaFicha(colaborador.perfil, "adicionar_evolucao")}
        />
      ) : null}
      {aba === "dados" ? (
        <div className="flex flex-col gap-5">
          <section
            aria-label="Consentimento"
            className="flex max-w-2xl flex-col gap-1 rounded-xl border bg-card p-4 text-sm"
          >
            <p>
              <span className="font-medium">Aceite LGPD:</span> registrado em{" "}
              {aceiteEm}
            </p>
            <p>
              <span className="font-medium">Promoções por WhatsApp:</span>{" "}
              {c.aceita_whatsapp_marketing ? "aceita" : "não aceita"}
            </p>
          </section>

          {podeEditar ? (
            <FormularioCliente
              cliente={{
                id: c.id,
                nome: c.nome,
                whatsapp: c.whatsapp ? formatarTelefone(c.whatsapp) : "",
                cpf: c.cpf ? formatarCPF(c.cpf) : "",
                email: c.email ?? "",
                dataNascimento: c.data_nascimento ?? "",
                endereco: c.endereco ?? "",
                origem: (c.origem ?? "") as "" | OrigemCliente,
                observacoes: c.observacoes ?? "",
                aceitaWhatsappMarketing: c.aceita_whatsapp_marketing,
              }}
            />
          ) : (
            <dl className="grid max-w-2xl gap-4 rounded-xl border bg-card p-4 sm:grid-cols-2">
              <Linha
                rotulo="WhatsApp"
                valor={c.whatsapp ? formatarTelefone(c.whatsapp) : null}
              />
              <Linha rotulo="CPF" valor={c.cpf ? formatarCPF(c.cpf) : null} />
              <Linha rotulo="E-mail" valor={c.email} />
              <Linha
                rotulo="Data de nascimento"
                valor={
                  c.data_nascimento
                    ? c.data_nascimento.split("-").reverse().join("/")
                    : null
                }
              />
              <Linha rotulo="Endereço" valor={c.endereco} />
              <Linha rotulo="Como conheceu a clínica" valor={origem} />
              <div className="sm:col-span-2">
                <Linha rotulo="Observações" valor={c.observacoes} />
              </div>
            </dl>
          )}
        </div>
      ) : null}
      {aba === "historico" ? (
        <AbaHistorico atendimentos={atendimentos} />
      ) : null}
    </div>
  );
}
