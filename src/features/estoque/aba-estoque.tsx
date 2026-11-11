import Link from "next/link";
import { TriangleAlert } from "lucide-react";
import type { DadosEstoque, ProdutoDoEstoque } from "@/app/(app)/produtos/dados-estoque";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatarQuantidade } from "@/lib/dominio/catalogo";
import { formatarBRL } from "@/lib/dominio/dinheiro";
import { ROTULO_ABA_PRODUTOS, type AbaProdutos } from "@/lib/dominio/permissoes";
import { cn } from "@/lib/utils";
import { BotaoAjuste } from "./dialogo-ajuste";
import { BotaoEntrada, type ProdutoDoDialogo } from "./dialogo-entrada";
import { FiltroHistorico, HistoricoEstoque } from "./historico";

const HREF_ABA: Record<AbaProdutos, string> = {
  produtos: "/produtos",
  estoque: "/produtos?aba=estoque",
};

/** Abas da página de Produtos em pílulas (só a dona tem mais de uma). */
export function AbasProdutos({ abas, atual }: { abas: AbaProdutos[]; atual: AbaProdutos }) {
  return (
    <nav aria-label="Seções de produtos" className="-mx-1 max-w-full overflow-x-auto">
      <ul className="flex w-max gap-1 rounded-full bg-muted p-1">
        {abas.map((aba) => (
          <li key={aba}>
            <Link
              href={HREF_ABA[aba]}
              aria-current={aba === atual ? "page" : undefined}
              className={cn(
                "inline-flex min-h-11 items-center rounded-full px-4 text-sm font-medium whitespace-nowrap",
                aba === atual ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {ROTULO_ABA_PRODUTOS[aba]}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

const paraDialogo = (p: ProdutoDoEstoque): ProdutoDoDialogo => ({
  id: p.id,
  nome: p.nome,
  unidade: p.unidade,
  estoqueAtual: p.estoqueAtual,
  custoCentavos: p.custoCentavos,
});

function Acoes({ p, hoje }: { p: ProdutoDoEstoque; hoje: string }) {
  const d = paraDialogo(p);
  return (
    <>
      <BotaoEntrada produto={d} hoje={hoje} />
      <BotaoAjuste produto={d} />
    </>
  );
}

const qtd = (n: number, unidade: string) => `${formatarQuantidade(n)} ${unidade}`;

function AbaixoDoMinimo({ produtos, hoje }: { produtos: ProdutoDoEstoque[]; hoje: string }) {
  return (
    <section
      aria-labelledby="estoque-abaixo-t"
      className={cn(
        "flex flex-col gap-3 rounded-xl border p-4",
        produtos.length > 0 ? "border-destructive/40 bg-destructive/5" : "bg-card",
      )}
    >
      <h2
        id="estoque-abaixo-t"
        className="flex items-center gap-2 font-titulo text-lg font-semibold text-ouro-escuro"
      >
        {produtos.length > 0 && <TriangleAlert className="size-5 text-destructive" aria-hidden />}
        Abaixo do mínimo
      </h2>
      {produtos.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhum produto abaixo do mínimo.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {produtos.map((p) => (
            <li
              key={p.id}
              data-testid="abaixo-do-minimo"
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-card p-3"
            >
              <div className="min-w-0">
                <p className="font-medium break-words">{p.nome}</p>
                <p className="text-sm text-muted-foreground">
                  <span className="font-semibold text-destructive">{qtd(p.estoqueAtual, p.unidade)}</span> · mínimo{" "}
                  {qtd(p.estoqueMinimo, p.unidade)}
                </p>
              </div>
              <BotaoEntrada produto={paraDialogo(p)} hoje={hoje} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * Aba Estoque (dona): abaixo do mínimo no topo, produtos com Entrada e Ajuste
 * e o histórico com filtro de produto e período. `produtoId` destaca o
 * produto vindo de "Ver estoque" e filtra o histórico.
 */
export function AbaEstoque({
  dados,
  produtoId,
  de,
  ate,
  hoje,
}: {
  dados: DadosEstoque;
  produtoId: string | null;
  de: string;
  ate: string;
  hoje: string;
}) {
  const { produtos } = dados;
  const destacado = (p: ProdutoDoEstoque) => p.id === produtoId;
  return (
    <div className="flex flex-col gap-6">
      <AbaixoDoMinimo produtos={dados.abaixo} hoje={hoje} />

      <section aria-labelledby="estoque-produtos-t" className="flex flex-col gap-3">
        <h2 id="estoque-produtos-t" className="font-titulo text-lg font-semibold text-ouro-escuro">
          Produtos
        </h2>
        {produtos.length === 0 ? (
          <p className="text-muted-foreground">Nenhum produto cadastrado.</p>
        ) : (
          <>
            {/* Celular: cartões */}
            <ul className="flex flex-col gap-3 md:hidden">
              {produtos.map((p) => (
                <li
                  key={p.id}
                  data-testid="produto-estoque"
                  aria-current={destacado(p) ? "true" : undefined}
                  className={cn(
                    "flex flex-col gap-3 rounded-xl border bg-card p-4",
                    p.abaixo && "border-destructive bg-destructive/5",
                    destacado(p) && "ring-2 ring-primary",
                    !p.ativo && "opacity-70",
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <p className="min-w-0 font-medium break-words">{p.nome}</p>
                    {!p.ativo ? <Badge variant="destructive">Inativo</Badge> : null}
                  </div>
                  <dl className="grid grid-cols-3 gap-x-4 gap-y-2 text-sm">
                    <div>
                      <dt className="text-muted-foreground">Estoque</dt>
                      <dd className={cn("tabular-nums", p.abaixo && "font-semibold text-destructive")}>
                        {qtd(p.estoqueAtual, p.unidade)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Mínimo</dt>
                      <dd className="tabular-nums">{qtd(p.estoqueMinimo, p.unidade)}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Custo</dt>
                      <dd className="tabular-nums">{formatarBRL(p.custoCentavos)}</dd>
                    </div>
                  </dl>
                  <div className="flex flex-wrap gap-2">
                    <Acoes p={p} hoje={hoje} />
                  </div>
                </li>
              ))}
            </ul>

            {/* Tablet e computador: tabela */}
            <div className="hidden rounded-xl border bg-card md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Produto</TableHead>
                    <TableHead className="text-right">Estoque</TableHead>
                    <TableHead className="text-right">Mínimo</TableHead>
                    <TableHead className="text-right">Custo</TableHead>
                    <TableHead>
                      <span className="sr-only">Ações</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {produtos.map((p) => (
                    <TableRow
                      key={p.id}
                      data-testid="produto-estoque"
                      aria-current={destacado(p) ? "true" : undefined}
                      className={cn(
                        p.abaixo && "bg-destructive/5",
                        destacado(p) && "bg-accent",
                        !p.ativo && "opacity-70",
                      )}
                    >
                      <TableCell className="font-medium">
                        {p.nome}
                        {!p.ativo ? (
                          <Badge variant="destructive" className="ml-2">
                            Inativo
                          </Badge>
                        ) : null}
                      </TableCell>
                      <TableCell
                        className={cn("text-right tabular-nums", p.abaixo && "font-semibold text-destructive")}
                      >
                        {qtd(p.estoqueAtual, p.unidade)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{qtd(p.estoqueMinimo, p.unidade)}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatarBRL(p.custoCentavos)}
                        <span className="text-muted-foreground">/{p.unidade}</span>
                      </TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-2">
                          <Acoes p={p} hoje={hoje} />
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </section>

      <HistoricoEstoque movimentos={dados.movimentos} limitado={dados.limitado}>
        <FiltroHistorico
          produtos={produtos.map((p) => ({ id: p.id, nome: p.nome }))}
          produtoId={produtoId}
          de={de}
          ate={ate}
        />
      </HistoricoEstoque>
    </div>
  );
}
