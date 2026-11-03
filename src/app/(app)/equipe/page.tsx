import Link from "next/link";
import { Pencil, Plus } from "lucide-react";
import { BotaoAtivo } from "@/features/equipe/botao-ativo";
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
import { ROTULO_PERFIL } from "@/lib/dominio/permissoes";
import { exigirPerfil } from "@/lib/sessao";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

export const metadata = { title: "Equipe | Madame Fê Clinic" };

export default async function EquipePage() {
  const { colaborador: eu } = await exigirPerfil("dona");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("colaboradores")
    .select("id, nome, funcao, perfil, cor, ativo")
    .order("ativo", { ascending: false })
    .order("nome", { ascending: true });
  if (error) throw new Error(`Falha ao carregar a equipe: ${error.message}`);
  const equipe = data ?? [];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-titulo text-2xl font-semibold tracking-wide text-ouro-escuro">
          Equipe
        </h1>
        <Button asChild>
          <Link href="/equipe/novo">
            <Plus aria-hidden />
            Novo colaborador
          </Link>
        </Button>
      </div>

      {equipe.length === 0 ? (
        <p className="text-muted-foreground">Nenhum colaborador cadastrado.</p>
      ) : (
        <>
          {/* Celular: cartões */}
          <ul className="flex flex-col gap-3 md:hidden">
            {equipe.map((c) => (
              <li
                key={c.id}
                className={cn("flex flex-col gap-3 rounded-xl border bg-card p-4", !c.ativo && "opacity-70")}
              >
                <div className="flex items-start gap-3">
                  <span
                    aria-hidden
                    className="mt-1 size-4 shrink-0 rounded-full border"
                    style={{ backgroundColor: c.cor }}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium break-words">{c.nome}</p>
                    <p className="text-sm text-muted-foreground">{c.funcao || "Sem função definida"}</p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Badge variant="secondary">{ROTULO_PERFIL[c.perfil]}</Badge>
                  <Badge variant={c.ativo ? "outline" : "destructive"}>
                    {c.ativo ? "Ativa" : "Inativa"}
                  </Badge>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button asChild variant="outline" size="sm">
                    <Link href={`/equipe/${c.id}`}>
                      <Pencil aria-hidden />
                      Editar<span className="sr-only"> {c.nome}</span>
                    </Link>
                  </Button>
                  <BotaoAtivo id={c.id} nome={c.nome} ativo={c.ativo} ehVoceMesma={c.id === eu.id} />
                </div>
              </li>
            ))}
          </ul>

          {/* Tablet e computador: tabela */}
          <div className="hidden rounded-xl border bg-card md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>Função</TableHead>
                  <TableHead>Perfil</TableHead>
                  <TableHead>Situação</TableHead>
                  <TableHead>
                    <span className="sr-only">Ações</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {equipe.map((c) => (
                  <TableRow key={c.id} className={cn(!c.ativo && "opacity-70")}>
                    <TableCell>
                      <span className="flex items-center gap-3 font-medium">
                        <span
                          aria-hidden
                          className="size-4 shrink-0 rounded-full border"
                          style={{ backgroundColor: c.cor }}
                        />
                        {c.nome}
                      </span>
                    </TableCell>
                    <TableCell>{c.funcao || "—"}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">{ROTULO_PERFIL[c.perfil]}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={c.ativo ? "outline" : "destructive"}>
                        {c.ativo ? "Ativa" : "Inativa"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-2">
                        <Button asChild variant="outline" size="sm">
                          <Link href={`/equipe/${c.id}`}>
                            <Pencil aria-hidden />
                            Editar<span className="sr-only"> {c.nome}</span>
                          </Link>
                        </Button>
                        <BotaoAtivo id={c.id} nome={c.nome} ativo={c.ativo} ehVoceMesma={c.id === eu.id} />
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </div>
  );
}
