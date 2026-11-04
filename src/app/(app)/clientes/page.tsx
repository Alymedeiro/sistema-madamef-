import Link from "next/link";
import { Plus } from "lucide-react";
import { BuscaClientes } from "@/features/clientes/busca-clientes";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { perfisComAcesso } from "@/lib/dominio/permissoes";
import { formatarTelefone } from "@/lib/dominio/telefone";
import { exigirPerfil } from "@/lib/sessao";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { consultarClientes, LIMITE_BUSCA } from "./consulta";

export const metadata = { title: "Clientes | Madame Fê Clinic" };

const primeiro = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function ClientesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[]; inativas?: string | string[] }>;
}) {
  const { colaborador } = await exigirPerfil(...perfisComAcesso("clientes"));
  const podeEditar = colaborador.perfil !== "profissional";

  const params = await searchParams;
  const termo = primeiro(params.q).slice(0, 80);
  const incluirInativas = podeEditar && primeiro(params.inativas) === "1";

  // O RLS já limita a profissional às clientes vinculadas a ela.
  const supabase = await createClient();
  const clientes = await consultarClientes(supabase, termo, {
    incluirInativas,
    listarSeVazio: true,
  });

  const hrefInativas = (ligar: boolean) => {
    const p = new URLSearchParams();
    if (termo.trim()) p.set("q", termo.trim());
    if (ligar) p.set("inativas", "1");
    const q = p.toString();
    return q ? `/clientes?${q}` : "/clientes";
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-titulo text-2xl font-semibold tracking-wide text-ouro-escuro">
          Clientes
        </h1>
        {podeEditar ? (
          <Button asChild>
            <Link href="/clientes/novo">
              <Plus aria-hidden />
              Nova cliente
            </Link>
          </Button>
        ) : null}
      </div>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <BuscaClientes termoInicial={termo} incluirInativas={incluirInativas} />
        {podeEditar ? (
          <Link
            href={hrefInativas(!incluirInativas)}
            className="inline-flex min-h-11 items-center text-sm font-medium text-ouro-escuro underline-offset-4 hover:underline"
          >
            {incluirInativas ? "Ocultar clientes inativas" : "Mostrar clientes inativas"}
          </Link>
        ) : null}
      </div>

      {clientes.length === 0 ? (
        <p className="text-muted-foreground">
          {termo.trim()
            ? "Nenhuma cliente encontrada. Confira o nome, o WhatsApp ou o CPF digitado."
            : "Nenhuma cliente cadastrada."}
        </p>
      ) : (
        <>
          <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {clientes.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/clientes/${c.id}`}
                  className={cn(
                    "flex min-h-14 flex-col justify-center gap-0.5 rounded-xl border bg-card px-4 py-3 transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:outline-none",
                    !c.ativo && "opacity-70",
                  )}
                >
                  <span className="flex flex-wrap items-center gap-2 font-medium break-words">
                    {c.nome}
                    {!c.ativo ? <Badge variant="destructive">Inativa</Badge> : null}
                  </span>
                  <span className="text-sm text-muted-foreground">
                    {c.whatsapp ? formatarTelefone(c.whatsapp) : "Sem WhatsApp"}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          {clientes.length >= LIMITE_BUSCA ? (
            <p className="text-sm text-muted-foreground">
              Mostrando as primeiras {LIMITE_BUSCA} clientes. Digite o nome, o WhatsApp ou o CPF
              para encontrar outra.
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}
