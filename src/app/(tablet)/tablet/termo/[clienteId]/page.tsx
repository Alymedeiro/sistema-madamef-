import Link from "next/link";
import { notFound } from "next/navigation";
import { MolduraTablet } from "@/features/ficha/moldura-tablet";
import { TelaTermo } from "@/features/ficha/termos/tela-termo";
import { formatarCPF } from "@/lib/dominio/cpf";
import { destinoInterno } from "@/lib/ficha/destino";
import { formatarNoFuso } from "@/lib/dominio/tempo";
import { exigirPerfil } from "@/lib/sessao";
import { createClient } from "@/lib/supabase/server";
import { idSchema } from "@/lib/validacao";

export const metadata = { title: "Termo de consentimento | Madame Fê Clinic" };

type Busca = { modelo?: string | string[]; agendamento?: string | string[]; voltar?: string | string[] };

const primeiro = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function TabletTermoPage({
  params,
  searchParams,
}: {
  params: Promise<{ clienteId: string }>;
  searchParams: Promise<Busca>;
}) {
  // Colhem dona, recepção e profissional; o RLS limita a profissional às clientes vinculadas.
  await exigirPerfil("dona", "recepcao", "profissional");
  const { clienteId } = await params;
  if (!idSchema.safeParse(clienteId).success) notFound();
  const busca = await searchParams;
  const padrao = `/clientes/${clienteId}?aba=termos`;
  const voltarPara = destinoInterno(primeiro(busca.voltar), padrao);
  const modeloId = primeiro(busca.modelo);
  const agendamentoParam = primeiro(busca.agendamento);
  const agendamentoId =
    agendamentoParam && idSchema.safeParse(agendamentoParam).success ? agendamentoParam : null;

  const supabase = await createClient();
  const { data: cliente, error: erroCliente } = await supabase
    .from("clientes")
    .select("id, nome, cpf")
    .eq("id", clienteId)
    .maybeSingle();
  if (erroCliente) throw new Error(`Falha ao carregar a cliente: ${erroCliente.message}`);
  if (!cliente) notFound();

  if (!modeloId || !idSchema.safeParse(modeloId).success) {
    // Sem termo escolhido: a recepção escolhe entre os ativos.
    const { data: ativos, error } = await supabase
      .from("modelos_termo")
      .select("id, titulo")
      .eq("ativo", true)
      .order("titulo", { ascending: true });
    if (error) throw new Error(`Falha ao carregar os termos: ${error.message}`);
    const q = (id: string) => {
      const p = new URLSearchParams({ modelo: id, voltar: voltarPara });
      if (agendamentoId) p.set("agendamento", agendamentoId);
      return p.toString();
    };
    return (
      <MolduraTablet titulo="Termo de consentimento" voltarPara={voltarPara}>
        <div className="flex flex-col gap-4">
          <p className="text-muted-foreground">Escolha o termo para {cliente.nome} assinar.</p>
          {(ativos ?? []).length === 0 ? (
            <p>Nenhum termo cadastrado.</p>
          ) : (
            (ativos ?? []).map((t) => (
              <Link
                key={t.id}
                href={`/tablet/termo/${clienteId}?${q(t.id)}`}
                className="flex min-h-14 items-center rounded-xl border bg-card px-5 text-xl font-medium hover:bg-accent"
              >
                {t.titulo}
              </Link>
            ))
          )}
        </div>
      </MolduraTablet>
    );
  }

  // O link pode ser de uma versão antiga: usa a versão ativa do mesmo termo.
  const { data: pedido, error: erroModelo } = await supabase
    .from("modelos_termo")
    .select("id, grupo_id, titulo, texto, ativo")
    .eq("id", modeloId)
    .maybeSingle();
  if (erroModelo) throw new Error(`Falha ao carregar o termo: ${erroModelo.message}`);
  if (!pedido) notFound();
  let modelo = pedido;
  if (!pedido.ativo) {
    const { data: vigente, error } = await supabase
      .from("modelos_termo")
      .select("id, grupo_id, titulo, texto, ativo")
      .eq("grupo_id", pedido.grupo_id)
      .eq("ativo", true)
      .maybeSingle();
    if (error) throw new Error(`Falha ao carregar o termo: ${error.message}`);
    if (!vigente) notFound();
    modelo = vigente;
  }

  return (
    <MolduraTablet titulo={modelo.titulo} voltarPara={voltarPara}>
      <TelaTermo
        clienteId={clienteId}
        clienteNome={cliente.nome}
        clienteCpf={cliente.cpf ? formatarCPF(cliente.cpf) : null}
        hoje={formatarNoFuso(new Date(), "dd/MM/yyyy")}
        modelo={{ id: modelo.id, titulo: modelo.titulo, texto: modelo.texto }}
        agendamentoId={agendamentoId}
        voltarPara={voltarPara}
      />
    </MolduraTablet>
  );
}
