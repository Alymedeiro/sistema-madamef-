import Link from "next/link";
import { ClipboardCheck, Globe, Pencil, Plus } from "lucide-react";
import { BotaoAtivoItem } from "@/features/catalogo/botao-ativo-item";
import { DialogoCategoria } from "@/features/servicos/dialogo-categoria";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatarDuracao } from "@/lib/dominio/catalogo";
import { formatarBRL } from "@/lib/dominio/dinheiro";
import { perfisComAcesso } from "@/lib/dominio/permissoes";
import { exigirPerfil } from "@/lib/sessao";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

export const metadata = { title: "Serviços | Madame Fê Clinic" };

type Servico = {
  id: string;
  nome: string;
  categoria_id: string;
  descricao: string | null;
  duracao_min: number;
  preco_centavos: number;
  permite_online: boolean;
  exige_avaliacao: boolean;
  dias_retorno: number | null;
  ativo: boolean;
};

function Marcas({ s }: { s: Servico }) {
  if (!s.permite_online && !s.exige_avaliacao) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {s.permite_online ? (
        <Badge variant="outline">
          <Globe aria-hidden />
          Online
        </Badge>
      ) : null}
      {s.exige_avaliacao ? (
        <Badge variant="outline">
          <ClipboardCheck aria-hidden />
          Exige avaliação
        </Badge>
      ) : null}
    </div>
  );
}

function Acoes({ s }: { s: Servico }) {
  return (
    <>
      <Button asChild variant="outline" size="sm">
        <Link href={`/servicos/${s.id}`}>
          <Pencil aria-hidden />
          Editar<span className="sr-only"> {s.nome}</span>
        </Link>
      </Button>
      <BotaoAtivoItem tipo="servico" id={s.id} nome={s.nome} ativo={s.ativo} />
    </>
  );
}

export default async function ServicosPage() {
  // Todos consultam; só a dona edita (o RLS também barra a escrita).
  const { colaborador } = await exigirPerfil(...perfisComAcesso("servicos"));
  const ehDona = colaborador.perfil === "dona";

  const supabase = await createClient();
  let consultaServicos = supabase
    .from("servicos")
    .select(
      "id, nome, categoria_id, descricao, duracao_min, preco_centavos, permite_online, exige_avaliacao, dias_retorno, ativo",
    )
    .order("nome", { ascending: true });
  if (!ehDona) consultaServicos = consultaServicos.eq("ativo", true);

  const [categoriasRes, servicosRes] = await Promise.all([
    supabase.from("categorias_servico").select("id, nome").order("nome", { ascending: true }),
    consultaServicos,
  ]);
  if (categoriasRes.error) {
    throw new Error(`Falha ao carregar as categorias: ${categoriasRes.error.message}`);
  }
  if (servicosRes.error) {
    throw new Error(`Falha ao carregar os serviços: ${servicosRes.error.message}`);
  }

  const servicos: Servico[] = servicosRes.data ?? [];
  const grupos = (categoriasRes.data ?? [])
    .map((c) => ({ ...c, servicos: servicos.filter((s) => s.categoria_id === c.id) }))
    // Quem só consulta não precisa ver categoria vazia.
    .filter((g) => ehDona || g.servicos.length > 0);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-titulo text-2xl font-semibold tracking-wide text-ouro-escuro">
          Serviços
        </h1>
        {ehDona ? (
          <div className="flex flex-wrap gap-2">
            <DialogoCategoria />
            <Button asChild>
              <Link href="/servicos/novo">
                <Plus aria-hidden />
                Novo serviço
              </Link>
            </Button>
          </div>
        ) : null}
      </div>

      {grupos.length === 0 ? (
        <p className="text-muted-foreground">
          {ehDona
            ? "Nenhum serviço cadastrado. Comece criando uma categoria."
            : "Nenhum serviço cadastrado."}
        </p>
      ) : (
        grupos.map((g) => (
          <section key={g.id} className="flex flex-col gap-3" aria-labelledby={`cat-${g.id}`}>
            <div className="flex flex-wrap items-center gap-2">
              <h2 id={`cat-${g.id}`} className="font-titulo text-lg font-semibold text-ouro-escuro">
                {g.nome}
              </h2>
              {ehDona ? <DialogoCategoria categoria={{ id: g.id, nome: g.nome }} /> : null}
            </div>

            {g.servicos.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhum serviço nesta categoria.</p>
            ) : (
              <>
                {/* Celular: cartões */}
                <ul className="flex flex-col gap-3 md:hidden">
                  {g.servicos.map((s) => (
                    <li
                      key={s.id}
                      className={cn(
                        "flex flex-col gap-3 rounded-xl border bg-card p-4",
                        !s.ativo && "opacity-70",
                      )}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <p className="min-w-0 font-medium break-words">{s.nome}</p>
                        <p className="shrink-0 font-semibold">{formatarBRL(s.preco_centavos)}</p>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {formatarDuracao(s.duracao_min)}
                        {s.dias_retorno ? ` · Retorno em ${s.dias_retorno} dias` : ""}
                      </p>
                      <Marcas s={s} />
                      {ehDona ? (
                        <div className="flex flex-wrap items-center gap-2">
                          {!s.ativo ? <Badge variant="destructive">Inativo</Badge> : null}
                          <Acoes s={s} />
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ul>

                {/* Tablet e computador: tabela */}
                <div className="hidden rounded-xl border bg-card md:block">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Serviço</TableHead>
                        <TableHead>Duração</TableHead>
                        <TableHead>Preço</TableHead>
                        <TableHead>Detalhes</TableHead>
                        {ehDona ? (
                          <TableHead>
                            <span className="sr-only">Ações</span>
                          </TableHead>
                        ) : null}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {g.servicos.map((s) => (
                        <TableRow key={s.id} className={cn(!s.ativo && "opacity-70")}>
                          <TableCell className="font-medium">
                            {s.nome}
                            {!s.ativo ? (
                              <Badge variant="destructive" className="ml-2">
                                Inativo
                              </Badge>
                            ) : null}
                          </TableCell>
                          <TableCell>{formatarDuracao(s.duracao_min)}</TableCell>
                          <TableCell>{formatarBRL(s.preco_centavos)}</TableCell>
                          <TableCell>
                            <div className="flex flex-col gap-2">
                              <Marcas s={s} />
                              {s.dias_retorno ? (
                                <span className="text-sm text-muted-foreground">
                                  Retorno em {s.dias_retorno} dias
                                </span>
                              ) : null}
                            </div>
                          </TableCell>
                          {ehDona ? (
                            <TableCell>
                              <div className="flex justify-end gap-2">
                                <Acoes s={s} />
                              </div>
                            </TableCell>
                          ) : null}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </>
            )}
          </section>
        ))
      )}
    </div>
  );
}
