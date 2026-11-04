import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { formatarNoFuso } from "@/lib/dominio/tempo";
import { exigirPerfil } from "@/lib/sessao";
import { createClient } from "@/lib/supabase/server";
import { idSchema } from "@/lib/validacao";

export const metadata = { title: "Registro de acessos | Madame Fê Clinic" };

const POR_PAGINA = 100;

const ROTULO_ACAO: Record<"visualizou" | "criou" | "alterou" | "arquivou", string> = {
  visualizou: "Visualizou",
  criou: "Criou",
  alterou: "Alterou",
  arquivou: "Arquivou",
};

const ROTULO_ENTIDADE: Record<string, string> = {
  anamneses: "Anamnese",
  termos_assinados: "Termo assinado",
  fotos: "Foto",
  evolucoes: "Evolução",
  exportacao: "Exportação",
};

const um = <T,>(v: T | T[] | null | undefined): T | null =>
  Array.isArray(v) ? (v[0] ?? null) : (v ?? null);

const primeiro = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function AcessosPage({
  searchParams,
}: {
  searchParams: Promise<{ cliente?: string | string[]; pagina?: string | string[] }>;
}) {
  await exigirPerfil("dona");
  const sp = await searchParams;
  const clientePedido = primeiro(sp.cliente);
  const clienteId = clientePedido && idSchema.safeParse(clientePedido).success ? clientePedido : null;
  const n = Number.parseInt(primeiro(sp.pagina) ?? "1", 10);
  const pagina = Number.isFinite(n) && n >= 1 ? Math.min(n, 100000) : 1;
  const de = (pagina - 1) * POR_PAGINA;

  const supabase = await createClient();
  let consulta = supabase
    .from("auditoria")
    .select(
      "id, ocorrido_em, acao, entidade, cliente_id, colaboradores(nome), clientes(nome)",
    )
    .order("ocorrido_em", { ascending: false })
    .order("id", { ascending: false })
    // Uma a mais só para saber se existe próxima página.
    .range(de, de + POR_PAGINA);
  if (clienteId) consulta = consulta.eq("cliente_id", clienteId);
  const { data, error } = await consulta;
  if (error) throw new Error(`Falha ao carregar o registro de acessos: ${error.message}`);
  const linhas = (data ?? []).slice(0, POR_PAGINA);
  const temProxima = (data ?? []).length > POR_PAGINA;

  const href = (p: number) => {
    const q = new URLSearchParams();
    if (clienteId) q.set("cliente", clienteId);
    if (p > 1) q.set("pagina", String(p));
    const s = q.toString();
    return `/configuracoes/acessos${s ? `?${s}` : ""}`;
  };
  const linkClasse =
    "inline-flex min-h-11 items-center rounded-md border bg-card px-4 text-sm font-medium text-ouro-escuro hover:bg-accent";

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
        Registro de acessos
      </h1>
      {clienteId ? (
        <p className="text-sm">
          Filtrado por uma cliente.{" "}
          <Link href="/configuracoes/acessos" className="font-medium text-ouro-escuro underline">
            Ver todos
          </Link>
        </p>
      ) : null}

      {linhas.length === 0 ? (
        <p className="text-muted-foreground">Nenhum acesso registrado.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="border-b bg-muted/50">
              <tr>
                <th className="p-3 font-medium">Data e hora</th>
                <th className="p-3 font-medium">Colaboradora</th>
                <th className="p-3 font-medium">Ação</th>
                <th className="p-3 font-medium">O quê</th>
                <th className="p-3 font-medium">Cliente</th>
              </tr>
            </thead>
            <tbody>
              {linhas.map((l) => (
                <tr key={l.id} className="border-b last:border-0">
                  <td className="p-3 whitespace-nowrap">
                    {formatarNoFuso(l.ocorrido_em, "dd/MM/yyyy HH:mm:ss")}
                  </td>
                  <td className="p-3">{um(l.colaboradores)?.nome ?? "—"}</td>
                  <td className="p-3">{ROTULO_ACAO[l.acao] ?? l.acao}</td>
                  <td className="p-3">{ROTULO_ENTIDADE[l.entidade] ?? l.entidade}</td>
                  <td className="p-3">
                    {l.cliente_id ? (
                      <Link
                        href={`/clientes/${l.cliente_id}`}
                        className="font-medium text-ouro-escuro underline-offset-4 hover:underline"
                      >
                        {um(l.clientes)?.nome ?? "Cliente"}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <nav aria-label="Páginas" className="flex items-center gap-2">
        {pagina > 1 ? (
          <Link href={href(pagina - 1)} className={linkClasse}>
            Mais recentes
          </Link>
        ) : null}
        <span className="text-sm text-muted-foreground">Página {pagina}</span>
        {temProxima ? (
          <Link href={href(pagina + 1)} className={linkClasse}>
            Mais antigos
          </Link>
        ) : null}
      </nav>
    </div>
  );
}
